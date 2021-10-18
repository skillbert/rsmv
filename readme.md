# RuneScape Model Viewer (.js)
A RuneScape cache downloader, decoder and model viewer implemented in javascript. The tool will download the cache directly from the game servers and decode parts of into usable data and models. 

## Installation
A new-ish version of node.js is needed with native build tools installed (the node.js installer will ask about this).
After that run the following commands in your systems console.


```sh
#install the dependencies
npm i
#compile the native nodejs dependencies for use in electron
npm exec electron-rebuild

#build the solution
npm run build
#or start the build script in watch mode
npm run watch

#start
npm start
```

## Jagex copyrights
Jagex is generally aware of the existence of cache decoding tools like this one and they are extensively used for the runescape wiki. However, in the interest of the games integrity and the future of these tools please do no publicly share leaks or unreleased content found using this tool.


## Todo
* Convert the remaining js files to ts
  * There are some issues with function classes not being completely compatible with es6 classes
  * Possibly move the opcodes json files to ts so type checking/hinting can be applied
* Remove the files in obsolete
* Add back the electron distribution packager
* Fix the different command line scripts in .bin and src/opcodes
  * possibly make them part of the build script gulpfile
* Test in mac/linux
* jmat and utils/Stream are still using function classes and have very inconsistent typing
* Model decoding can be many times faster by using `typedarray`s

## Credits
//TODO