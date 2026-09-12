# satellite-viewer

A visualization tool for viewing satellites at your location. This uses Deck.gl to render CelesTrak(tm) data. Most of the mathematical calculations in this demo are from satellite.js.

The satellite positions are rendered in a first person view. Some artistic liberty has been taken with the distances and visual sizes of satellites because they would be otherwise too small to see or click on.

What you can do: You can pan around the view and zoom. Hovering on a satellite will show its name.

The purpose of this demo is to mainly learn about multi-threading of CPU heavy calculations in the browser. I used a single Web Worker to calculate the positions of around 16k satellites. Even that's sometimes too much for a single thread if the goal is 60Hz rendering frequency. I could have sent the data at a lower frequency and let the client thread interpolate, but that would have been more complicated code-wise without any real added benefit. 

I wanted JS main thread solely dedicated to Deck.gl and React. To that end, I created a SharedArrayBuffer that gets updated by the worker. The binary data in that buffer gets loaded straight into GPU from Deck.gl without any main thread processing, ie. Deck.gl doesn't run item by item checks on the data. I noticed that this lowered sped up the rendering by dozens of ms over 60 frames, so a few ms per 16.7ms frame.
