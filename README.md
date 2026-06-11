# GradCam 📸 | Cinematic Webcam Effects for Musicians

GradCam is a highly responsive, modern client-side web application designed for musicians, live-streamers, and content creators. It applies real-time, full-screen cinematic visual filters onto your webcam stream, interactively shaped by your hand coordinates and transitioned using natural hand gestures.

## 🚀 Features

- **Aesthetic Casual Interface**: Designed like modern creative platforms (e.g. Spotify, Notion) with clean pill-shaped buttons, frosted glass layouts, soft background gradients, and a clear activity diagnostics dashboard.
- **8 Cinematic Visual Filters**:
  1. **Dreamy Glow (Bloom)**: Adds a soft glowing halo to highlights. Height controls blur radius; width controls brightness.
  2. **Ambient Leaks**: Neon cyan/violet gradient light leaks drifting across the screen, attracted to your hand coordinates.
  3. **Solar Flare**: A glowing sun flare at your hand, casting radial bokeh rings along the line to the screen center.
  4. **Noir Spotlight**: A high-contrast grayscale feed with a feathered, circular full-color spotlight tracking your palm.
  5. **Cosmic Nebula**: Interstellar gaseous clouds (violet, cyan, magenta) and twinkling star bokeh tracking your palm.
  6. **Golden Hour**: Warm vintage film grading with sunset rays and floating dust specs reacting to hand motion.
  7. **Prism Glass**: Radial glass refraction mimicking a camera prism, shifting refractive angles on hand movement.
  8. **Neon Synthwave**: Vaporwave grading with a 3D vector grid whose vanishing perspective tracks your hand.
- **Single Open-and-Close Gesture Control**:
  - **Move Hand**: Dynamically shapes filter parameters.
  - **Open & Close Palm**: Instantly transitions to the **next** filter.
  - **Quickly Reopen Fist (within 1.2s)**: Reverts back to the **previous** filter — acts as an undo.
- **Double-Buffered Cross-Fade**: offscreen canvas buffers render and blend filters together, creating a butter-smooth cross-fade transition.
- **Interactive Audio Feedback**: Built-in Web Audio synthesizer generating electronic tone feedback for gestures.
- **Full Video & Audio Recording**: Record your performance with microphone input and download high-quality WebM videos directly from the interface.

