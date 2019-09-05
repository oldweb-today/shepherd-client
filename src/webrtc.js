export {WebRTC, determineVideoFormats};


export default class WebRTC {

  constructor(target, peer_id, media_controller, lock_audio) {

    this.debug = true;
    this.lock_audio = lock_audio;
    this.peer_connection;
    this.media_controller = media_controller;

    this.video_element;
    this.audio_element;

    this.target = target;
    this.peer_id = peer_id;
    this.candidate_number = 0;
  }

  start() {
    if (this.video_element || this.audio_element) {
      console.log("already started");
      return;
    }
  };

  getPeerId() {
    return this.peer_id;
  }

  onIncomingConfiguration(msg) {
    if (this.debug) {
      console.log("Create peerConnection with configuration" + JSON.stringify(msg));
    }
    this.createCall(msg);
  }

  // ICE candidate received from peer, add it to the peer connection
  onIncomingICE(ice) {
    let candidate = new RTCIceCandidate(ice);
    this.peer_connection.addIceCandidate(candidate).catch(() => this.setError("Error adding ice candidate"));
  }

  setStatus(status) {
    if (this.debug) {
      console.log("WebRTC-status:" + status);
    }
  }

  setError(error) {
    if (this.debug) {
      console.log("WebRTC-error: " + error);
    }
  }

  onIncomingSDP(sdp) {
    this.peer_connection.setRemoteDescription(sdp).then(() => {
      this.setStatus("Remote SDP set");
      if (sdp.type !== "offer")
        return;
      this.setStatus("Got SDP offer");
      this.peer_connection.createAnswer()
        .then(this.onLocalDescription.bind(this)).catch(() => this.setError("Error setting local description"));
    }).catch((event) => this.setError("Error setting remote description:" + event));
  }

  // Local description was set, send it to peer
  onLocalDescription(desc) {
    if (this.debug) {
      console.log("Got local description: " + JSON.stringify(desc));
    }
    this.peer_connection.setLocalDescription(desc).then(function() {
      this.setStatus("Sending SDP answer");
      let sdp = {'sdp': this.peer_connection.localDescription};
      this.media_controller.send(sdp);
    }.bind(this));
  }


  handleMessage(data) {
    try {
      let msg = JSON.parse(data);
      // Incoming JSON signals the beginning of a call
      if (msg.sdp != null) {
        this.onIncomingSDP(msg.sdp);
        return true;
      } else if (msg.ice != null) {
        this.onIncomingICE(msg.ice);
        return true;
      } else if (msg.iceServers != null) {
        this.onIncomingConfiguration(msg);
        return true;
      }
    } catch (e) {}

    return false;
  }

  unlockAudio() {
    if (this.debug) {
      console.log("Unlock webrtc audio");
    }
    this.lock_audio = false;
    if (this.audio_element != null) {
      this.audio_element.muted = false;
    }
    if (this.video_element != null) {
      this.video_element.muted = false;
    }
  }

  close() {
    this.setStatus("Closing WebRTC connection");
    this.peer_connection.close();
    this.peer_connection = null;
  };

  createCall(configuration) {

    this.peer_connection = new RTCPeerConnection(configuration);
    this.peer_connection.ontrack = this.onRemoteTrackAdded.bind(this);
    this.peer_connection.oniceconnectionstatechange = this.onIceConnectionStateChange.bind(this);
    this.peer_connection.onicecandidate = this.onIceCandidate.bind(this);

    this.setStatus("Created peer connection for call, waiting for SDP");
  }

  onIceCandidate(event) {
      let candidate = event.candidate;

      if (candidate == null) {
        console.log("Ice Candidates Done, Sent " + this.candidate_number);
        return;
      }

      console.log("send candidate remotely: " + candidate.candidate);
      this.media_controller.send({'ice': candidate});
      this.candidate_number++;
    };

  onIceConnectionStateChange(event) {
    if (this.peer_connection.iceConnectionState === "connected") {
        if (this.debug) {
          console.log("WebRTC is on!");
        }
    }
  }

  syncVideoElement() {
    let canvas = this.target.getElementsByTagName('canvas')[0];
    if (this.video_element != null  && canvas != undefined) {
      let canvas_position = canvas.getBoundingClientRect();
      let left = canvas_position.x;
      let top = canvas_position.y;
      let width = canvas_position.width;
      let height = canvas_position.height;

      if (this.debug) {
        console.log("Video position is left " + left + ", top " + top + ", width " + width + ", height " + height);
      }

      this.video_element.style.left = left + "px";
      this.video_element.style.top = top + "px";
      if (width > 0) {
        this.video_element.style.width = width + "px";
      }
      if (height > 0) {
        this.video_element.style.height = height + "px";
      }
    }
  }

  onRemoteTrackAdded(event) {
    console.log('receive ' + event.streams.length + 'Streams. stream 1  = ' + event.streams[0].getVideoTracks().length + ' video tracks and ' + event.streams[0].getAudioTracks().length + ' audio tracks' );

    if (event.streams[0].getAudioTracks().length > 0 && event.streams[0].getVideoTracks().length == 0) {
      if (this.audio_element != null) {
        try {
          this.audio_element.pause();
        } catch (e) {
          console.log('can not pause audio element');
        }
      } else {
        this.audio_element = document.createElement('audio');
        this.audio_element.autoplay = true;
        this.target.append(this.audio_element);
      }

      this.audio_element.srcObject = event.streams[0];

      this.audio_element.play().catch((err) => this.setError("audio_element.play() error: " + err));

    }

    if (event.streams[0].getVideoTracks().length > 0) {
      if (this.audio_element != null) {
        this.audio_element.pause();
      }

      if (this.video_element == null) {
        // Full WebRTC
        this.video_element = document.createElement('video');
        if (this.debug) {
          this.video_element.style.backgroundColor = "blue";
        }
        //this.video_element.style.opacity = "0.5";
        this.video_element.style.position = "absolute"
        this.video_element.style.top = "0px";
        this.video_element.style.left = "0px";
        //this.video_element.style.width = "100%"
        this.video_element.style.zIndex = "-1";

        this.video_element.contentEditable = true;
        // Hide real VNC
        this.target.getElementsByClassName('canvas')[0].style.opacity = 0;

        if (this.lock_audio) {
          this.video_element.muted = true;
        }


        this.target.append(this.video_element);
        window.onresize = this.syncVideoElement.bind(this);
        this.syncVideoElement();
      } else {
        try {
          this.video_element.pause();
        } catch (e) {
          console.log('can not pause video element');
        }
      }

      this.video_element.srcObject = event.streams[0];

      var video = this.video_element;

      this.video_element.play().catch((err) => {
        if (err.name === 'NotAllowedError') {
          video.muted = true;
          document.body.addEventListener("click", () => {
            video.muted = false;
          }, { once: true });
          video.play().catch((err) => this.setError("video_element.play() error: " + err));
        } else {
          this.setError("video_element.play() error: " + err);
        }
      });
    }
  }
};

function determineVideoFormats() {

  return new Promise((resolve, reject) => {
    try {
      var conn = new RTCPeerConnection();
      if (conn.addTransceiver) {
        conn.addTransceiver("video", {"direction": "recvonly"});
      }
      conn.createOffer({"offerToReceiveVideo": true}).then((offer) => {
        conn.close();

        var formats = [];
        var found = {};

        var rx = /a=rtpmap[:]\d+ (\w+)\//g;

        var res = null;

        while ((res = rx.exec(offer.sdp)) != null) {
          var format = res[1];
          if (!found[format]) {
            formats.push(format);
            found[format] = 1;
          }
        }

        resolve(formats);
      });
    } catch (e) {
      console.log("Error WebRTC not supported")
      resolve();
    }

  });
}

