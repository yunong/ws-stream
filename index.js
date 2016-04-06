'use strict';

var Duplex = require('stream').Duplex;
var util = require('util');

var assert = require('assert-plus');
var bunyan = require('bunyan');

/**
 * @param {Object} opts - The options object.
 * @param {Object} opts.ws - The websocket.
 * @param {Object} [bunyan=log] - The Bunyan logger.
 * @param {Object} [streamOpts=null] - The Bunyan logger.
 *
 * @constructor
 */
var WSStream = function WSStream(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.ws, 'opts.ws');
    assert.optionalObject(opts.log, 'opts.log');

    Duplex.call(this, opts);

    var self = this;

    if (opts.log) {
        this._log = opts.log.child({
            component: 'ws-stream'
        });
    } else {
        this._log = bunyan.createLogger({
            name: 'ws-stream',
            level: bunyan.INFO,
            serializers: bunyan.stdSerializers
        });
    }

    this._ws = opts.ws;

    this._paused = false;

    self._ws.on('close', function onClose() {
        self._log.debug('WSStream: stream closed');
        self.push(null);
        self.end();
        self.emit('close');
    });

    self._ws.on('error', function onError(err) {
        self._log.error({err: err}, 'WSStream: got error');
        self._emit('error', err);
    });

    self._ws.on('message', function incoming(msg, flags) {
        self._log.debug({message: msg.toString(), flags: flags},
                        'WSStream: got msg');

        // push() returns false if the stream is paused or it has exceeded
        // the high water mark. Therefore we pause the underlying WS connection
        // Note there may be additional messages already enqueued on the event
        // loop -- so we must check to see if we've already paused before.
        if (!self.push(msg) && !self._paused) {
            self._log.debug('WSStream: pausing');
            self._ws.pause();
            self._paused = true;
        }
    });
};
util.inherits(WSStream, Duplex);

module.exports = WSStream;

WSStream.prototype._write = function _write(data, enc, cb) {
    var self = this;
    self._log.debug({data: data}, 'WSStream._write: entering');
    self._ws.send(data, null, cb);
};

WSStream.prototype._read = function _read() {
    var self = this;

    if (self._paused) {
        self._paused = false;
        self._log.debug('WSStream: resuming');
        self._ws.resume();
    }
};
