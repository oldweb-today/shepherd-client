// Play Audio with MediaSource extensions received over a websocket
var OPUS_MIME_TYPE = 'audio/webm; codecs="opus"';
var MP3_MIME_TYPE = 'audio/mpeg';

// This represents the order in which the types are tried
const AUDIO_TYPES = [
  {"id": "mp3",
    "type": MP3_MIME_TYPE},

  {"id": "opus",
    "type": OPUS_MIME_TYPE},
];

export {getBestAudioType, WSAudio};


function getBestAudioType() {
  if (window.MediaSource) {
    for (var i = 0; i < AUDIO_TYPES.length; i++) {
      if (window.MediaSource.isTypeSupported(AUDIO_TYPES[i].type)) {
        return AUDIO_TYPES[i].id;
      }
    }
  }
};


function WSAudio (browser_info, init_params) {
  init_params = init_params || {};

  var MAX_BUFFERS = 250;
  var MIN_START_BUFFERS = 10;

  var minLatency = 0.2; // 200ms
  var maxLatency = 0.5  // 500ms
  this.latencyCheck = null;

  this.ws = null;
  this.ws_url = null;

  this.errCount = 0;

  this.allowAppend = false;

  this.audio = null;
  this.audio_mime = null;
  this.mediasource = null;
  this.buffer = null;

  this.buffQ = [];
  this.buffCount = 0;
  this.buffSize = 0;

  this.get_audio_mime = function(browser_info) {
    for (var i = 0; i < AUDIO_TYPES.length; i++) {
      if (AUDIO_TYPES[i].id == browser_info.audio) {
        return AUDIO_TYPES[i].type;
      }
    }

    console.log("Audio not inited, unknown audio type: " + browser_info.audio);
    return null;
  }

  this.get_ws_url = function(browser_info) {
    var ws_url = (window.location.protocol == "https:" ? "wss:" : "ws:");
    ws_url += window.location.hostname;

    var audio_port = browser_info.cmd_port;

    if (init_params.proxy_ws) {
      ws_url += "/" + init_params.proxy_ws + audio_port;
    } else {
      ws_url += ":" + audio_port + "/audio_ws";
    }

    return ws_url;
  }


  this.start = function() {
    if (this.audio) {
      return true;
    }

    this.audio_mime = this.get_audio_mime(browser_info);
    this.ws_url = this.get_ws_url(browser_info);

    if (!this.audio_mime) {
      return false;
    }

    this.latencyCheck = setInterval(this.latencyController.bind(this), 250);

    this.mediasource = new MediaSource();
    this.mediasource.addEventListener("sourceopen", this.sourceOpen.bind(this));

    this.mediasource.addEventListener("error", (function(event) {
      this.audioError("MediaSource Error", event);
    }).bind(this));

    this.audio = new Audio();
    this.audio.src = URL.createObjectURL(this.mediasource);
    this.audio.autoplay = true;
    this.audio.load();
    this.audio.play().catch(function() { });

    return true;
  }

  this.sourceOpen = function() {
    if (this.mediasource.sourceBuffers.length) {
      console.log("source already open");
      return;
    }

    var buffer = null;

    try {
      buffer = this.mediasource.addSourceBuffer(this.audio_mime);
    } catch (e) {
      console.log("Opening Source Error: " + e);
      return;
    }

    buffer.mode = "sequence";
    //buffer.timestampOffset = 0;

    buffer.addEventListener("error", (function(event) {
      this.audioError("buffer error: " + (this.buffCount), event);
    }).bind(this));

    buffer.addEventListener("updateend", this.onUpdateEnd.bind(this));

    this.buffer = buffer;

    this.allowAppend = true;

    this.initWs();
  };

  this.close = function() {
    console.log("Closing Audio");
    try {
      if (this.latencyCheck) {
        clearInterval(this.latencyCheck);
      }

      if (this.mediasource) {
        this.mediasource.removeSourceBuffer(this.buffer);
        if (this.mediasource.readyState == "open") {
          this.mediasource.endOfStream();
        }
      }
      this.buffer = null;

    } catch(e) {
      console.log("Error Closing: " + e);
    }
    this.mediasource = null;

    try {
      if (this.audio) {
        this.audio.pause();
      }
      this.audio = null;
    } catch (e) {
      console.log("Error Closing: " + e);
    }

    if (this.ws) {
      console.log("Closing websocket");
      try {
        this.ws.close();
      } catch(e) {}

      this.ws = null;
    }
  }

  this.mergeBuffers = function() {
    var merged;

    if (this.buffQ.length == 1) {
      merged = this.buffQ[0];
    } else {
      merged = new Uint8Array(this.buffSize);

      var length = this.buffQ.length;
      var offset = 0;

      for (var i = 0; i < length; i++) {
        var curr = this.buffQ[i];
        if (curr.length <= 0) {
          continue;
        }
        merged.set(curr, offset);
        offset += curr.length;
      }
    }

    this.buffQ = [];
    this.buffCount++;
    return merged;
  }

  this.onUpdateEnd = function() {
    this.allowAppend = true;
    this.updateNext();
  }

  this.updateNext = function() {
    if (!this.buffQ.length) {
      return;
    }

    try {
      var merged = this.mergeBuffers();
      this.buffer.appendBuffer(merged);
      this.allowAppend = false;
      this.buffSize -= merged.length;
      this.errCount = 0;
    } catch (e) {
      this.audioError("Error Adding Buffer: " + e);
    }
  }

  this.latencyController = function() {
    // check for latency and seek forward if necessary
    try {
      var latency = this.audio.buffered.end(0) - this.audio.currentTime;
      if (latency > maxLatency) {
        this.audio.currentTime = this.audio.buffered.end(0) - minLatency;
        console.log("Audio has been seeked by ", Math.round((latency - minLatency) * 1000), " ms");
      }

    } catch(e) {

    }
  }

  this.audioError = function(msg, event) {
    if (this.audio.error) {
      console.log(msg);
      console.log(this.audio.error);
      //console.log("num processed: " + this.buffCount);
      this.errCount += 1;
      //if (this.errCount == 1) {
      //    setTimeout(restartAudio, 3000);
      //}
    }
  }

  this.queue = function(buffer) {
    /*
    if (this.buffSize > 200000) {
        if (this.buffCount > 0) {
            var res = this.buffQ.shift();
            this.buffSize -= res.length;
            console.log("dropping old buffers");
        } else {
            // don't drop the starting buffers
            console.log("dropping new buffers");
            this.updateNext();
            return;
        }
    }
    */

    buffer = new Uint8Array(buffer);
    this.buffQ.push(buffer);
    this.buffSize += buffer.length;

    if (this.allowAppend) {
      this.updateNext();
    }
  }

  this.initWs = function() {
    try {
      this.ws = new WebSocket(this.ws_url, "binary");
    } catch (e) {
      this.audioError("WS Open Failed");
    }

    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener("open", ws_open.bind(this));
    this.ws.addEventListener("close", ws_close.bind(this));
    this.ws.addEventListener("message", ws_message.bind(this));
    this.ws.addEventListener('error', ws_error.bind(this));
  }

  var ws_open = function(event) {
    //this.send("ready");
  }

  var ws_message = function(event) {
    if (this.errCount == 0) {
      this.queue(event.data);
    }
  }

  var ws_error = function() {
    this.audioError("WS Error");
  }

  var ws_close = function() {
    this.audioError("WS Close");
  }

  return this;

  //return {"start": start,
  //        "stop": stop,
  //        "restart": restartAudio,
  //        "getAudio": function () {return  audioWS.audio;},
  //}
};




