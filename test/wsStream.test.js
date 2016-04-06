'use strict';

var PassThrough = require('stream').PassThrough;

var assert = require('chai').assert;
var bunyan = require('bunyan');
var sinon = require('sinon');
var vasync = require('vasync');

var Ws = require('ws');

var WSStream = require('../index');

var PORT = process.env.PORT || 1337;

var CLIENT_MSG = 'Remember when you were young, you shone like the sun.';
var SERVER_MSG = 'Come on you raver, you seer of visions, come on you ' +
    'painter, you piper, you prisoner, and shine!';

describe('ws stream', function () {
    var LOG = bunyan.createLogger({
        name: 'rs client stream tests',
        level: process.env.LOG_LEVEL || bunyan.INFO,
        serializers: bunyan.stdSerializers
    });

    var WS_SERVER;
    var WS_CLIENT;
    var WS_SERVER_STREAM;
    var WS_CLIENT_STREAM;

    beforeEach(function (done) {
        WS_SERVER = new Ws.Server({port: PORT});
        WS_SERVER.on('listening', done);
    });

    afterEach(function () {
        // We really should not end this until we know the server is closed.
        // Unfortunately ws does not provide an API to let us know that the
        // server has been closed.
        //
        // This might introduce race conditions between tests.
        WS_CLIENT.close();
        WS_SERVER.close();
    });

    it('server and client streams pushing data and client close',
       function (done) {
        var expected = 2;
        var endCount = 0; // ensure we get end events on both server and client
        WS_SERVER.on('connection', function (socket) {
            WS_SERVER_STREAM = new WSStream({
                log: LOG,
                ws: socket
            });

            // can't use once here since we need to listen for the 'end' event.
            // the stream is in paused mode until there is a readable listener
            // so we must continue to listen.
            var srCount = 0;
            WS_SERVER_STREAM.on('readable', function () {
                srCount++;
                var read = WS_SERVER_STREAM.read();

                if (srCount === 1) {
                    assert.equal(read, CLIENT_MSG);
                    expected--;
                    WS_SERVER_STREAM.write(SERVER_MSG);
                }
            });

            WS_SERVER_STREAM.on('end', function () {
                endCount++;

                if (endCount === 2) {
                    assert.equal(0, expected);
                    done();
                }
            });
        });

        WS_CLIENT = new Ws('ws://localhost:' + PORT);
        WS_CLIENT.on('open', function () {
            WS_CLIENT_STREAM = new WSStream({
                log: LOG,
                ws: WS_CLIENT
            });
            // note that readable gets fired when the stream ends, since the
            // producer pushes a null string, even tho the stream is supposed
            // end
            var crCount = 0;
            WS_CLIENT_STREAM.on('readable', function () {
                var read = WS_CLIENT_STREAM.read();
                crCount++;

                if (crCount === 1) {
                    assert.equal(read.toString(), SERVER_MSG);
                    expected--;
                    WS_CLIENT.close();
                }
            });

            WS_CLIENT_STREAM.on('end', function () {
                endCount++;

                if (endCount === 2) {
                    assert.equal(0, expected);
                    done();
                }
            });

            WS_CLIENT_STREAM.write(CLIENT_MSG);
        });
    });

    it('readable stream hits highwater mark', function (done) {
        WS_SERVER.once('connection', function (socket) {
            console.log('connect');
            var spy = sinon.spy(socket, 'pause');
            WS_SERVER_STREAM = new WSStream({
                log: LOG,
                ws: socket,
                highWaterMark: 8
            });
            var ps = new PassThrough({
                highWaterMark: 8
            });
            WS_SERVER_STREAM.pipe(ps);

            WS_SERVER_STREAM.on('end', function () {
                assert(spy.calledOnce);
                console.log('done');
                return done();
            });

        });

        WS_CLIENT = new Ws('ws://localhost:' + PORT);
        WS_CLIENT.on('open', function () {
            console.log('open');
            WS_CLIENT_STREAM = new WSStream({
                log: LOG,
                ws: WS_CLIENT
            });

            // send a bunch of messages, this should over flow the highwater
            // mark and cause the server readable stream to pause.
            vasync.forEachParallel({ func: function (arg, cb) {
                WS_CLIENT_STREAM.write(CLIENT_MSG, null, cb);
            },inputs: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
            function cb(err, results) {
                assert.ifError(err);
                WS_CLIENT.close();
                WS_SERVER_STREAM.on('readable', function () {
                    WS_SERVER_STREAM.read();
                    // noop so that we can unblock the stream after it's been
                    // paused
                });
            });
        });
    });
});
