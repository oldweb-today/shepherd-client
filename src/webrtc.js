export {WebRTC};


function WebRTC(target, peer_id, data) {

  let debug = true;
  let connect_attempts = 0;
  let peer_connection;
  let ws_conn;

  let video_element;
  let audio_element;

  this.start = function() {
    if (video_element || audio_element) {
      console.log("already started");
      return;
    }

    connectToSignalingServer();
  };

  function connectToSignalingServer() {
    connect_attempts++;
    if (connect_attempts > 100) {
      setError("Too many connection attempts, aborting. Refresh page to try again");
      return;
    }

    // Fetch the peer id to use
    let peer_id = getPeerId();
    let ws_url = getSignallingServer();
    setStatus("Connecting to server " + ws_url + ", attempt= " + connect_attempts);
    ws_conn = new WebSocket(ws_url);
    /* When connected, immediately register with the server */
    ws_conn.addEventListener('open', () => {
      ws_conn.send('HELLO ' + peer_id)
      setStatus("Registering with server, peer-id = " + peer_id);
    });

    ws_conn.addEventListener('error', onServerError);
    ws_conn.addEventListener('message', onServerMessage);
    ws_conn.addEventListener('close', onServerClose);
  }

  function getPeerId() {
    return peer_id;
  }

  function getSignallingServer() {
    let ws_url = (window.location.protocol === "https:" ? "wss://" : "ws://");
    ws_url += window.location.hostname;

    var audio_port = data.ports.cmd_port;

    if (data.proxy_ws) {
      ws_url += "/" + data.proxy_ws + audio_port;
    } else {
      ws_url += ":" + audio_port + "/audio_ws";
    }

    return ws_url;
  }

  function onServerError() {
    setError("Unable to connect to server, did you add an exception for the certificate?");
    // Retry after 3 seconds
    window.setTimeout(connectToSignalingServer, 3000);
  }

  function handleIncomingError(message) {
    if (debug) {
      console.log("handleIncomingError: " + message);
    }
  }

  function onServerMessage(event) {
    if (debug) {
      console.log("Received from websocket " + event.data);
    }
    let msg;
    switch (event.data) {
      case "HELLO":
        setStatus("Registered with server, waiting for call");
        return;
      default:
        if (event.data.startsWith("ERROR")) {
          handleIncomingError(event.data);
          return;
        }
        // Handle incoming JSON SDP and ICE messages
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          if (e instanceof SyntaxError) {
            handleIncomingError("Error parsing incoming JSON: " + event.data);
          } else {
            handleIncomingError("Unknown error parsing response: " + event.data);
          }
          return;
        }
        // Incoming JSON signals the beginning of a call
        if (msg.sdp != null) {
          onIncomingSDP(msg.sdp);
        } else if (msg.ice != null) {
          onIncomingICE(msg.ice);
        } else if (msg.iceServers != null) {
          onIncomingConfiguration(msg);

        } else {
          handleIncomingError("Unknown incoming JSON: " + msg);
        }
    }
  }

  function onIncomingConfiguration(msg) {
    if (debug) {
      console.log("Create peerConnection with configuration" + JSON.stringify(msg));
    }
    createCall(msg);
  }

  // ICE candidate received from peer, add it to the peer connection
  function onIncomingICE(ice) {
    let candidate = new RTCIceCandidate(ice);
    peer_connection.addIceCandidate(candidate).catch(() => setError("Error adding ice candidate"));
  }

  function onServerClose(event) {
    setStatus('Disconnected from server with code=' + event.code + ' reason=' + event.reason);
    reset();
    disconnectWebsocket();

    if (event.code !== 1002) {
      // Reset after a second
      window.setTimeout(connectToSignalingServer, 2000);
    } else {
      if (connect_attempts < 5) {
        // Retrieve to connect up to 5 times (peer-id might be in conflict if init_browser is called again)
        window.setTimeout(connectToSignalingServer, 2000);
      }
    }
  }

  function setStatus(status) {
    if (debug) {
      console.log("WebRTC-status:" + status);
    }
  }

  function setError(error) {
    if (debug) {
      console.log("WebRTC-error: " + error);
    }
  }

  function onIncomingSDP(sdp) {
    peer_connection.setRemoteDescription(sdp).then(() => {
      setStatus("Remote SDP set");
      if (sdp.type !== "offer")
        return;
      setStatus("Got SDP offer");
      peer_connection.createAnswer()
        .then(onLocalDescription).catch(() => setError("Error setting local description"));
    }).catch((event) => setError("Error setting remote description:" + event));
  }

  // Local description was set, send it to peer
  function onLocalDescription(desc) {
    if (debug) {
      console.log("Got local description: " + JSON.stringify(desc));
    }
    peer_connection.setLocalDescription(desc).then(function() {
      setStatus("Sending SDP answer");
      let sdp = JSON.stringify({'sdp': peer_connection.localDescription});
      ws_conn.send(sdp);
    });
  }


  function reset() {
    // Reset the media_element element and stop showing the last received frame
    try {

      if (video_element) {
        video_element.pause();
      }
      if (audio_element) {
        audio_element.pause()
      }

    } catch (e) {
      console.log("reset WebRTC error " + e);
    }

  }

  this.close = function() {
    setStatus("Closing WebRTC connection");
    disconnectWebsocket();
  };

  function disconnectWebsocket() {
    if (ws_conn) {
      setStatus("disconnect websocket");
      ws_conn.close();
    }

    if (peer_connection) {
      setStatus("disconnect peer");
      peer_connection.close();
      peer_connection = null;
    }
  }

  function createCall(configuration) {
    // Reset connection attempts because we connected successfully
    connect_attempts = 0;

    peer_connection = new RTCPeerConnection(configuration);
    peer_connection.ontrack = onRemoteTrackAdded;

    let anySent = 0;

    peer_connection.onicecandidate = (event) => {
      let candidate = event.candidate;

      if (candidate == null) {
        if (anySent) {
          console.log("Ice Candidates Done, Sent " + anySent);
          return;
        }
      }

      console.log("send candidate remotely: " + candidate.candidate);
      ws_conn.send(JSON.stringify({'ice': candidate}));
      anySent++;
    };

    setStatus("Created peer connection for call, waiting for SDP");
  }

  function onRemoteTrackAdded(event) {
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
        target.append(this.audio_element);
      }

      this.audio_element.srcObject = event.streams[0];

      this.audio_element.play().catch((err) => setError("audio_element.play() error: " + err));

    }

    if (event.streams[0].getVideoTracks().length > 0) {
      if (this.audio_element != null) {
        this.audio_element.pause();
      }

      if (this.video_element == null) {
        // Full WebRTC
        this.video_element = document.createElement('video');
        this.video_element.style.backgroundColor = "blue";
        //videos.style.opacity = "0.5";
        this.video_element.style.position = "absolute"
        this.video_element.style.top = "0px";
        this.video_element.style.left = "0px";
        this.video_element.style.width = "100%"
        this.video_element.style.zIndex = "-1";

        this.video_element.contentEditable = true;
        // Hide real VNC
        document.getElementsByClassName('canvas')[0].style.opacity = 0;
        this.video_element.autoplay = true;


        target.append(this.video_element);
      } else {
        try {
          this.video_element.pause();
        } catch (e) {
          console.log('can not pause video element');
        }
      }

      this.video_element.srcObject = event.streams[0];
      this.video_element.play().catch((err) => setError("video_element.play() error: " + err));
    }
  }

  return this;

};




