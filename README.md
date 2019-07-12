# shepherd-client

This modules provides the client side scripts necessary to run the new Webrecorder/oldweb-today browser system.

### Usage

To use the default setup, simply include the prebuilt [shepherd-client.bundle.js](dist/shepherd-client.bundle.js) and call `InitBrowserDefault()` function

This will initialize a remote browser on page load.

A basic setup might look as follows:

```html
<html>
  <head>
    <script src="/static/shepherd-client.bundle.js"></script>
    <script>
      InitBrowserDefault("{{ reqid }}", {"id": "browser"});
    </script>
  </head>
  <body>
    <div id="browser"></div>
  </body>
</html>
```

The `reqid` is an id of a requested browser from shepherd. It can be passed in from a server (the default)
or created dynamically using the Shepherd API.

*TODO: add more docs on how to use!*

### Building

To build the bundle (requires Node), run:

```bash
yarn install
yarn run build
```

(To build debug-friendly bundle run `yarn run build-dev`)


### Importing Module

To embed a remote/containerized browser into an existing application,
you can import the node module and use the CBrowser class:

```
import CBrowser from 'shepherd-client/src/browser';
...
let cb = new CBrowser(...)
```

