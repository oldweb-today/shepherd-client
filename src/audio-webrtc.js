export {WebRTCAudio};


function WebRTCAudio(peer_id, data) {

  let debug = true;
  let audio = null;
  let connect_attempts = 0;
  let peer_connection;
  let ws_conn;

  this.start = function() {
    audio = new Audio();
    audio.autoplay = true;
    audio.play().catch(setError);
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
      ws_conn.send('HELLO ' + peer_id);
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
    ws_url += window.location.hostname + ":" + data.cmd_port;
    return ws_url
  }

  function onServerError() {
    setError("Unable to connect to server, did you add an exception for the certificate?");
    // Retry after 3 seconds
    window.setTimeout(connectToSignalingServer, 3000);
  }

  function handleIncomingError(message) {
    console.log("handleIncomingError" + message);
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
        if (!peer_connection)
          createCall(msg);

        if (msg.sdp != null) {
          onIncomingSDP(msg.sdp);
        } else if (msg.ice != null) {
          onIncomingICE(msg.ice);
        } else {
          handleIncomingError("Unknown incoming JSON: " + msg);
        }
    }
  }

  // ICE candidate received from peer, add it to the peer connection
  function onIncomingICE(ice) {
    let candidate = new RTCIceCandidate(ice);
    peer_connection.addIceCandidate(candidate).catch(setError);
  }

  function onServerClose(event) {
    setStatus('Disconnected from server with code=' + event.code + ' reason=' + event.reason);
    resetAudio();
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
    console.log("WebRTC-error: " + error);
  }

  function onIncomingSDP(sdp) {
    peer_connection.setRemoteDescription(sdp).then(() => {
      setStatus("Remote SDP set");
      if (sdp.type !== "offer")
        return;
      setStatus("Got SDP offer");
      peer_connection.createAnswer()
        .then(onLocalDescription).catch(setError);
    }).catch(setError);
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


  function resetAudio() {
    // Reset the audio element and stop showing the last received frame
    try {
      audio.pause();
    } catch (e) {
      console.log("resetAudio error " + e);
    }

  }

  this.stop = function() {
    console.log("Stopping WebRTC audio connection");
    disconnectWebsocket();
  };

  function disconnectWebsocket() {
    if (ws_conn) {
      console.log("disconnect websocket");
      ws_conn.close();
    }

    if (peer_connection) {
      console.log("disconnect peer");
      peer_connection.close();
      peer_connection = null;
    }
  }

  function createCall(msg) {
    // Reset connection attempts because we connected successfully
    connect_attempts = 0;

    console.log('Creating RTCPeerConnection');


    peer_connection = new RTCPeerConnection(getRtcPeerConfiguration());
    peer_connection.ontrack = onRemoteTrackAdded;

    /* Send our video/audio to the other peer */
    if (!msg.sdp) {
      console.log("WARNING: First message wasn't an SDP message!?");
    }

    peer_connection.onicecandidate = (event) => {
      // We have a candidate, send it to the remote party with the
      // same uuid
      if (event.candidate == null) {
        console.log("ICE Candidate was null, done");
        return;
      }
      console.log("send candidate remotely" + event.candidate.candidate);

      ws_conn.send(JSON.stringify({'ice': event.candidate}));
    };

    setStatus("Created peer connection for call, waiting for SDP");
  }

  function onRemoteTrackAdded(event) {
    audio.srcObject = event.streams[0];
  }

  function getRtcPeerConfiguration() {
    let iceServers = [];
    if (data["webrtc_turn_server"]) {
      let server = data["webrtc_turn_server"];
      let credentials = data["webrtc_turn_credentials"];

      iceServers.push({
        "urls": server,
        "credential": credentials["password"],
        "username": credentials["username"]
      });
    }
    if (data["webrtc_stun_server"]) {
      let server = data["webrtc_stun_server"];
      iceServers.push({"urls": server});
    }
    console.log("iceservers = %O", iceServers);


    return {"iceServers": iceServers};
  }

  return this;
}




