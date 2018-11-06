import CBrowser from './src/browser'

export function InitBrowserDefault(reqid, opts) {
  document.addEventListener("readystatechange", function() {
    if (document.readyState != "complete") {
      return;
    }

    opts = opts || {};

    // if in iframe, notify parent of reqid
    if (window != window.parent && !opts.noNotifyParent) {
      window.parent.postMessage({"type": "reqid", "reqid": reqid}, "*");
    }

    if (!opts.on_countdown) {
      opts.on_countdown = function(seconds, countdown_text) {
        var text = document.getElementById("countdown");
        if (text) {
          text.innerText = countdown_text;
        }
      }
    }

    if (!opts.on_event) {
      opts.on_event = function(type, data) {
        if (type == "fail" || type == "expire") {
          window.location.reload();
        }
      }
    }

    if (opts.proxy_ws === undefined) {
      if (!window.location.port) {
        opts.proxy_ws = "_websockify?port=";
      }
    }

    if (opts.audio === undefined) {
      opts.audio = true;
    }

    if (opts.fill_window === undefined) {
      opts.fill_window = true;
    }

    if (opts.inactiveSecs === undefined) {
      opts.inactiveSecs = 10;
    }

    var id = opts.id || "#browser";

    return new CBrowser(reqid, id, opts);
  });
}



