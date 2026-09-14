# satellite-viewer

A visualization tool for viewing satellites at your location. You can run it on your localhost with "pnpm dev". The app uses your location only for calculations.


https://github.com/user-attachments/assets/9544b3a0-fc88-4ca9-a4cf-178382981a4a

The satellite positions are rendered in a first person view. Some artistic liberty has been taken with the distances and visual sizes of satellites because they would be otherwise too small to see or click on.

What you can do: You can pan around the view and zoom. Hovering on a satellite will show its name.

## Tech
The app uses Deck.gl to render CelesTrak(tm) data. Most of the mathematical calculations in this demo are from satellite.js. 

## Why
The purpose of this demo is to mainly learn about multi-threading of CPU heavy calculations in the browser. I used a single Web Worker to calculate the positions of around 16k satellites. A single worker on some older machines won't finish the calculations to fit 60Hz target window. That was solved by chunking up the satellite array and updating positions one chunk at a time. Having some of the satellites miss a frame or two is not really perceptible. I could have sent the data at a lower frequency and let the client thread interpolate, but that would have been more complicated code-wise without any real added benefit. If I want strictly 60 Hz, I could have the main worker spin up further workers.

I wanted JS main thread solely dedicated to Deck.gl and React. To that end, I created a SharedArrayBuffer that gets updated by the worker. Deck.gl has the ability to load binary data, which is great for performance reasons. The binary data in that buffer gets loaded straight into GPU from Deck.gl without any main thread processing, ie. Deck.gl doesn't run item by item checks on the data. I noticed that this lowered sped up the rendering by dozens of ms over 60 frames, so a few ms per 16.7ms frame.

