import {determineVideoFormats, WebRTC} from "./webrtc";
import {getBestAudioType, MSAudio} from "./audio-mediasource";

export {MediaController};


export default class MediaController {

  constructor(target, data){
    this.target = target;
    this.data = data;
    this.debug = true;
    this.connect_attempts = 0;
    this.ws_conn;
    this.webrtc_video_formats;

    this.webrtc = data.webrtc;
    this.webrtc_video = data.webrtc_video;

    this.lock_audio = data['lock_audio'];

    this.connectToServer();
  }

  getCommandServer() {
    let ws_url = (window.location.protocol === "https:" ? "wss://" : "ws://");
    ws_url += window.location.hostname;

    var audio_port = this.data.ports.cmd_port;

    if (this.data.proxy_ws) {
      ws_url += "/" + this.data.proxy_ws + audio_port;
    } else {
      ws_url += ":" + audio_port + "/audio_ws";
    }

    return ws_url;
  }

  connectToServer() {
    this.connect_attempts++;
    if (this.connect_attempts > 100) {
      console.log("Too many connection attempts, aborting. Refresh page to try again");
      return;
    }

    let ws_url = this.getCommandServer();
    this.setStatus("Connecting to server " + ws_url + ", attempt= " + this.connect_attempts);
    this.ws_conn = new WebSocket(ws_url);
    /* When connected, immediately register with the server */
    this.ws_conn.addEventListener('open', () => {
      this.ws_conn.send('HELLO ');
      this.setStatus("Registering with server");
    });

    this.ws_conn.addEventListener('error', this.onServerError.bind(this));
    this.ws_conn.addEventListener('message', this.onServerMessage.bind(this));
    this.ws_conn.addEventListener('close', this.onServerClose.bind(this));

    window.onbeforeunload = this.close.bind(this);
  }

  webrtcInitOptions(formats) {
    if (!this.webrtc) {
      return {"webrtc": false};
    }

    if (this.webrtc_video && formats) {
      if (typeof(this.webrtc_video) === "string") {
        formats.unshift(this.webrtc_video);
      }

      if (formats.includes("VP8") || formats.includes("H264")) {
        return {"webrtc": true, "webrtc_video": formats}
      }
    }

    return {"webrtc": true};
  }

  unlockAudio() {
    this.lock_audio = false;
    if (window.mediaPlugin != null) {
      window.mediaPlugin.unlockAudio()
    }
  }

  async initConnection() {
    const formats = await determineVideoFormats();
    const message = this.webrtcInitOptions(formats);

    this.webrtc_video_formats = formats;

    console.log(message);
    this.send(message);

    // instantiate right plugins
    if (message.webrtc) {
      window.mediaPlugin = new WebRTC(this.target, 1, this, this.lock_audio);
    } else {
      let audio_format = getBestAudioType();
      window.mediaPlugin = new MSAudio(audio_format, this, this.lock_audio);
    }
    window.mediaPlugin.start();
  }

  close () {
    this.disconnectWebsocket(1000);
    if (window.mediaPlugin) {
      window.mediaPlugin.close();
      window.mediaPlugin = null;
    }
  }

  onServerClose(event) {
    this.setStatus('Disconnected from server with code=' + event.code + ' reason=' + event.reason);

    // healthy close
    if (event.code === 1000) {
      return;
    }

    this.disconnectWebsocket();

    if (event.code !== 1002) {
      // Reset after a second
      window.setTimeout(this.connectToServer.bind(this), 2000);
    } else {
      if (this.connect_attempts < 5) {
        // Retrieve to connect up to 5 times (peer-id might be in conflict if init_browser is called again)
        window.setTimeout(this.connectToServer.bind(this), 2000);
      }
    }
  }

  disconnectWebsocket(code) {
    if (this.ws_conn) {
      this.setStatus("disconnect websocket");
      this.ws_conn.close(code);
    }
  }

  send(message) {
    this.ws_conn.send(JSON.stringify(message));
  }

  onServerError() {
    this.setStatus("Unable to connect to server, did you add an exception for the certificate?");
    // Retry after 3 seconds
    window.setTimeout(this.connectToServer.bind(this), 3000);
  }

  setStatus(status) {
    if (this.debug) {
      console.log("Media Controller - status:" + status);
    }
  }

  handleIncomingError(message) {
    if (this.debug) {
      console.log("handleIncomingError: " + message);
    }
  }

  onServerMessage(event) {
    let data = event.data;
    if (window.mediaPlugin != null) {
      if(window.mediaPlugin.handleMessage(data)) {
        return;
      }
    }
    let msg;

    switch (data) {
      case "HELLO":
        this.setStatus("Registered with server, determine which protocol to use");
        this.initConnection();
        return;
      default:
        if (event.data.startsWith("ERROR")) {
          this.handleIncomingError(event.data);
          return;
        }
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          if (e instanceof SyntaxError) {
            this.handleIncomingError("Error parsing incoming JSON: " + event.data);
          } else {
            this.handleIncomingError("Unknown error parsing response: " + event.data);
          }
          return;
        }
    }
  }

};
