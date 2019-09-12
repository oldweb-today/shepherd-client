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

export {getBestAudioType, MSAudio};


function getBestAudioType() {
  if (window.MediaSource) {
    for (var i = 0; i < AUDIO_TYPES.length; i++) {
      if (window.MediaSource.isTypeSupported(AUDIO_TYPES[i].type)) {
        return AUDIO_TYPES[i].id;
      } else {
          console.log("do not support " + AUDIO_TYPES[i].type);
      }
    }
  }
};

export default class MSAudio {
  constructor (format, media_controller, lock_audio) {
    this.format = format;
    this.media_controller = media_controller;
    this.lock_audio = lock_audio;

    this.MAX_BUFFERS = 250;
    this.MIN_START_BUFFERS = 10;

    this.minLatency = 0.2; // 200ms
    this.maxLatency = 0.5;  // 500ms

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

  }

  get_audio_mime() {
    for (var i = 0; i < AUDIO_TYPES.length; i++) {
      if (AUDIO_TYPES[i].id == this.format) {
        return AUDIO_TYPES[i].type;
      }
    }

    console.log("Audio not inited, unknown audio type: " + this.format);
    return null;
  }

  unlockAudio() {
    if (this.debug) {
      console.log("Unlock MSAudio");
    }
    this.lock_audio = false;
    if (this.audio != null) {
      this.audio.muted = false;
      this.audio.play().catch(function() { });
    }
  }

  start() {
    console.log('start MS Audio with format ' + this.format);
    this.audio_mime = this.get_audio_mime();

    if (!this.audio_mime) {
      console.log("audio Mime not found");
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
    this.audio.muted = this.lock_audio;
    this.audio.load();
    this.audio.play().catch(function(e) { console.log(e); });

    let msg = {"ms_audio": getBestAudioType()};
    this.media_controller.send(msg);
    this.media_controller.ws_conn.binaryType = 'arraybuffer';

    return true;
  }

  sourceOpen() {
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

  };

  close() {
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
      console.log("Error Closing mediasource: " + e);
    }
    this.mediasource = null;

    try {
      if (this.audio) {
        this.audio.pause();
      }
      this.audio = null;
    } catch (e) {
      console.log("Error Closing audio : " + e);
    }
  }

  mergeBuffers() {
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

  onUpdateEnd() {
    this.allowAppend = true;
    this.updateNext();
  }

  updateNext() {
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

  latencyController() {
    // check for latency and seek forward if necessary
    try {
      var latency = this.audio.buffered.end(0) - this.audio.currentTime;
      if (latency > this.maxLatency) {
        this.audio.currentTime = this.audio.buffered.end(0) - this.minLatency;
        console.log("Audio has been seeked by ", Math.round((latency - this.minLatency) * 1000), " ms");
      }

    } catch(e) {

    }
  }

  audioError(msg, event) {
    if (this.audio && this.audio.error) {
      console.log(msg);
      console.log(this.audio.error);
      this.errCount += 1;

    }
  }

  queue(buffer) {
    buffer = new Uint8Array(buffer);
    this.buffQ.push(buffer);
    this.buffSize += buffer.length;
    if (this.allowAppend) {
      this.updateNext();
    }
  }

  handleMessage(data) {
    if (this.errCount < 10) {

      this.queue(data);
    } else {
      console.log('too much error');
    }
    return true;
  }

};
