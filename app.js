/**
 * GradCam - Main Application Controller (Cinematic Filters Refactored)
 * Manages webcam streams, MediaPipe Hands pipeline, edge-triggered gesture logic, and sound synthesis.
 */

// Global Variables
let videoElement;
let canvasElement;
let ctx;
let cameraHelper = null;
let effectsManager;
let soundSynth;

// State Configuration
let isCamActive = false;
let isMirror = true;
let showSkeleton = true;
let effectIntensity = 50;
let transitionDuration = 500; // ms to cross-fade between presets
let globalCooldown = 0; // cooldown timestamp
const COOLDOWN_DURATION = 800; // ms between allowable triggers

// Recording State
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = 0;
let recordTimerInterval = null;
let mixedAudioDestination = null;

// Face Detection State
let faceDetector = null;
let latestFaces = []; // array of DOMRect bounding boxes
let faceDetectInterval = null;
let faceDetectBusy = false;

// Tracking State
let latestHandsData = [];

// Schmitt Trigger State machine configuration
const GESTURE_STATE = {
  UNKNOWN: 'UNKNOWN',
  OPEN_CONFIRMED: 'OPEN_CONFIRMED'
};

const handStates = {
  "Left": { state: GESTURE_STATE.UNKNOWN, openFramesCount: 0, lastCloseTime: 0, closeCount: 0 },
  "Right": { state: GESTURE_STATE.UNKNOWN, openFramesCount: 0, lastCloseTime: 0, closeCount: 0 }
};

// Visual Trigger Burst Ripple
let triggerBurst = null;

// Diagnostics
let fps = 0;
let frameCount = 0;
let lastFpsUpdate = 0;

// Initialize Elements on Page Load
document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  videoElement = document.getElementById("webcam");
  canvasElement = document.getElementById("output-canvas");
  ctx = canvasElement.getContext("2d");

  // Instances
  effectsManager = new EffectsManager();
  soundSynth = new SoundSynth();

  // Load UI event listeners
  initUIListeners();
  
  // Render active preset list
  renderPresetList();
  
  // Populate mic list (request permission early so labels are readable)
  populateMicList();
  
  // Init face detector
  initFaceDetector();
  
  // Start the 60 FPS render loop
  requestAnimationFrame(renderLoop);
});

// Sound Synthesizer using Web Audio API (Offline, Zero-network dependency)
class SoundSynth {
  constructor() {
    this.ctx = null;
  }
  
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  playTriggerSound() {
    this.init();
    if (!this.ctx) return;
    
    const now = this.ctx.currentTime;
    
    // A nice clean high-tech "chirp-beep" trigger sound
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.12); // C6
    
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    // Also feed into recording mix if recording
    if (this._mixDest) gain.connect(this._mixDest);
    
    osc.start(now);
    osc.stop(now + 0.18);
  }

  playSwitchSound() {
    this.init();
    if (!this.ctx) return;
    
    const now = this.ctx.currentTime;
    
    // Cinematic sweeps sound using dual oscillators and sweeping bandpass filter
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(90, now);
    osc1.frequency.exponentialRampToValueAtTime(650, now + 0.45);
    
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(180, now);
    osc2.frequency.exponentialRampToValueAtTime(980, now + 0.45);
    
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(100, now);
    filter.frequency.exponentialRampToValueAtTime(1500, now + 0.45);
    filter.Q.setValueAtTime(3.5, now);
    
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    // Also feed into recording mix if recording
    if (this._mixDest) gain.connect(this._mixDest);
    
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.55);
    osc2.stop(now + 0.55);
  }

  // Returns a MediaStream of the synth output so it can be mixed into recordings
  getOutputStream() {
    this.init();
    if (!this.ctx) return null;
    if (!this._dest) {
      this._dest = this.ctx.createMediaStreamDestination();
      // Reconnect gain nodes through the new destination as well
    }
    return this._dest.stream;
  }
}

// MediaPipe Hands Callback
function onHandResults(results) {
  const canvasWidth = canvasElement.width;
  const canvasHeight = canvasElement.height;
  
  let tempHands = [];
  
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const landmarks = results.multiHandLandmarks[i];
      const classification = results.multiHandedness[i];
      const label = classification ? classification.label : "Right";
      
      // Mirror / Map coordinate values
      const mapped = landmarks.map(pt => ({
        x: isMirror ? (1 - pt.x) * canvasWidth : pt.x * canvasWidth,
        y: pt.y * canvasHeight,
        z: pt.z
      }));
      
      // Palm center: Average of wrist (0), Index Base (5), Middle Base (9), Ring Base (13), Pinky Base (17)
      const pt0 = mapped[0];
      const pt5 = mapped[5];
      const pt9 = mapped[9];
      const pt13 = mapped[13];
      const pt17 = mapped[17];
      const palmCenter = {
        x: (pt0.x + pt5.x + pt9.x + pt13.x + pt17.x) / 5,
        y: (pt0.y + pt5.y + pt9.y + pt13.y + pt17.y) / 5
      };
      
      // Hand scale reference (wrist to knuckle 9)
      const handSize = Math.hypot(pt9.x - pt0.x, pt9.y - pt0.y);
      const indexTip = mapped[8];
      
      // Check curled fingers ratios to detect open vs closed hand
      const fingerTips = [8, 12, 16, 20];
      let totalRatio = 0;
      fingerTips.forEach(tip => {
        const dist = Math.hypot(mapped[tip].x - pt0.x, mapped[tip].y - pt0.y);
        totalRatio += dist / handSize;
      });
      const avgRatio = totalRatio / 4;
      
      // Schmitt trigger thresholds:
      // Fully open palm spread wide has avgRatio > 1.42
      // Closed hand fist has avgRatio < 1.12
      const isOpen = avgRatio > 1.42;
      const isClosed = avgRatio < 1.12;
      
      tempHands.push({
        landmarks: mapped,
        palmCenter,
        indexTip,
        handSize,
        label,
        isOpen,
        isClosed
      });
    }
  }
  
  latestHandsData = tempHands;
}

// 60 FPS Visual Update & Physics Loop
let lastRenderTime = 0;
function renderLoop(timestamp) {
  // Sizing adjust dynamically
  fitCanvasToContainer();
  
  const elapsed = Math.min(50, timestamp - lastRenderTime); // cap deltaTime to prevent large jumps
  lastRenderTime = timestamp;
  
  // Clear Canvas
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  if (isCamActive && videoElement.readyState >= 2) {
    const now = Date.now();
    let isCooldownActive = now < globalCooldown;
    
    // Track current hands in frame
    const activeLabels = latestHandsData.map(h => h.label);
    
    // Reset state for non-tracked hand labels (entered/exited frame)
    for (const label in handStates) {
      if (!activeLabels.includes(label)) {
        handStates[label].state = GESTURE_STATE.UNKNOWN;
        handStates[label].openFramesCount = 0;
      }
    }
    
    // Process Schmitt Trigger state machine for hand gestures (single close to switch)
    latestHandsData.forEach(hand => {
      const state = handStates[hand.label];
      
      if (hand.isOpen) {
        state.openFramesCount++;
        // Must see open palm continuously for 5 frames to confirm arming
        if (state.openFramesCount >= 5) {
          state.state = GESTURE_STATE.OPEN_CONFIRMED;
        }
      } else if (hand.isClosed) {
        // Trigger only if previously confirmed open
        if (state.state === GESTURE_STATE.OPEN_CONFIRMED) {
          const now = Date.now();
          if (now > globalCooldown) {
            triggerPresetSwitch(true); // instant switch
            
            // Play sound synthesizer feedback
            soundSynth.playSwitchSound();
            
            // Spawn large glowing splash ripple centered at hand trigger location
            triggerBurst = {
              x: hand.palmCenter.x,
              y: hand.palmCenter.y,
              radius: 25,
              maxRadius: 160,
              opacity: 1.0,
              color: null // active theme color
            };
            
            // Update cooldown to prevent accidental rapid double-triggering
            globalCooldown = now + COOLDOWN_DURATION;
          }
          
          // Reset state immediately so they must open the hand to re-arm
          state.state = GESTURE_STATE.UNKNOWN;
          state.openFramesCount = 0;
        }
      } else {
        // Intermediate state: slightly decay the count to absorb momentary noise
        if (state.openFramesCount > 0) {
          state.openFramesCount--;
        }
      }
    });
    
    // Draw cinematic effects — apply horizontal mirror flip to the canvas if mirror mode is on.
    // Hand landmark coordinates are already pre-flipped in onHandResults, so the skeleton stays aligned.
    if (isMirror) {
      ctx.save();
      ctx.translate(canvasElement.width, 0);
      ctx.scale(-1, 1);
    }

    effectsManager.update(latestHandsData, canvasElement.width, canvasElement.height, effectIntensity, elapsed);
    effectsManager.draw(ctx, canvasElement.width, canvasElement.height, showSkeleton, latestHandsData, videoElement);
    
    // Draw face spotlights on top of all filters
    if (latestFaces.length > 0) {
      drawFaceSpotlights(ctx, canvasElement.width, canvasElement.height);
    }
    
    // Render Visual Trigger Burst Ripple if active
    if (triggerBurst) {
      const burstColor = triggerBurst.color || getComputedStyle(document.body).getPropertyValue('--theme-color').trim() || '#e8a838';
      ctx.save();
      ctx.strokeStyle = burstColor;
      ctx.lineWidth = 3.5;
      ctx.globalAlpha = triggerBurst.opacity;
      ctx.shadowBlur = 15;
      ctx.shadowColor = burstColor;
      
      ctx.beginPath();
      ctx.arc(triggerBurst.x, triggerBurst.y, triggerBurst.radius, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.restore();
      
      // Animate expansion and fade out
      triggerBurst.radius += elapsed * 0.28;
      triggerBurst.opacity -= elapsed * 0.0025;
      
      if (triggerBurst.opacity <= 0) {
        triggerBurst = null;
      }
    }

    // Restore canvas transform after mirrored draw
    if (isMirror) {
      ctx.restore();
    }

    // Update live indicators
    updateHUD(true);
  } else {
    // Idle placeholder
    drawIdlePlaceholder(timestamp);
    updateHUD(false);
  }
  
  // Calculate FPS
  calculateFPS(timestamp);
  
  requestAnimationFrame(renderLoop);
}

// Trigger Preset Cycle (with optional instant transitions)
function triggerPresetSwitch(instant = false) {
  globalCooldown = Date.now() + 400; // cooldown to prevent accidental rapid triggers
  
  const nextPreset = (effectsManager.activePresetIndex + 1) % VISUAL_PRESETS.length;
  const duration = instant ? 50 : transitionDuration;
  effectsManager.startTransition(nextPreset, duration);
  
  // Sync styling variables
  setActivePresetStyle(nextPreset);
}

// Update UI selection class styling
function setActivePresetStyle(idx) {
  const preset = VISUAL_PRESETS[idx];
  document.getElementById("hud-preset-name").innerText = preset.name.toUpperCase();
  
  // Update Body Theme Class
  document.body.className = '';
  document.body.classList.add(preset.themeClass);
  
  // Highlight in Preset Gallery
  const listItems = document.querySelectorAll(".preset-item");
  listItems.forEach(item => {
    item.classList.remove("active");
    if (parseInt(item.getAttribute("data-preset")) === idx) {
      item.classList.add("active");
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  
  // Read active theme-color
  setTimeout(() => {
    const computedColor = getComputedStyle(document.body).getPropertyValue('--theme-color').trim();
    document.body.style.setProperty('--theme-color', computedColor);
    document.body.style.setProperty('--theme-color-glow', getComputedStyle(document.body).getPropertyValue('--theme-color-glow').trim());
  }, 50);
}

// Draw Idle Screen (before camera start)
function drawIdlePlaceholder(timestamp) {
  ctx.save();
  
  ctx.fillStyle = '#060910';
  ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
  
  // Grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < canvasElement.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasElement.height); ctx.stroke();
  }
  for (let y = 0; y < canvasElement.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasElement.width, y); ctx.stroke();
  }
  
  // Tech HUD center logo
  const cx = canvasElement.width / 2;
  const cy = canvasElement.height / 2;
  const radius = 80 + Math.sin(timestamp / 300) * 5;
  
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 10, timestamp / 1000, timestamp / 1000 + Math.PI * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 10, timestamp / 1000 + Math.PI, timestamp / 1000 + Math.PI * 1.5);
  ctx.stroke();
  
  ctx.font = '14px Syne';
  ctx.fillStyle = '#8b9bb4';
  ctx.textAlign = 'center';
  ctx.fillText("GRADCAM OFFLINE", cx, cy - 10);
  
  ctx.font = '10px JetBrains Mono';
  ctx.fillStyle = 'rgba(0, 242, 254, 0.7)';
  ctx.fillText("AWAITING CAMERA FEED", cx, cy + 15);
  
  ctx.restore();
}

// Keep Canvas resolution matching container dimensions
function fitCanvasToContainer() {
  const container = canvasElement.parentElement;
  const rect = container.getBoundingClientRect();
  
  const targetWidth = Math.floor(rect.width);
  const targetHeight = Math.floor(rect.height);
  
  if (canvasElement.width !== targetWidth || canvasElement.height !== targetHeight) {
    canvasElement.width = targetWidth;
    canvasElement.height = targetHeight;
  }
}

// Update Live HUD Indicators
function updateHUD(isOnline) {
  const dot = document.getElementById("hud-status-dot");
  const text = document.getElementById("hud-status-text");
  const handsCountEl = document.getElementById("hands-counter");
  const h1El = document.getElementById("h1-state");
  const h2El = document.getElementById("h2-state");
  const facesEl = document.getElementById("faces-counter");
  
  if (isOnline) {
    document.body.classList.add("camera-active");
    dot.className = "fa-solid fa-circle tracking-active";
    text.innerText = "STREAM ACTIVE";
    
    const count = latestHandsData.length;
    handsCountEl.innerText = `${count} / 2`;
    
    // Update individual hand stats
    const leftHand = latestHandsData.find(h => h.label === "Left");
    const rightHand = latestHandsData.find(h => h.label === "Right");
    
    h1El.innerText = leftHand ? (leftHand.isClosed ? "CLOSED (FIST)" : "OPEN") : "Not Found";
    h1El.className = leftHand && leftHand.isClosed ? "text-glow" : "";
    
    h2El.innerText = rightHand ? (rightHand.isClosed ? "CLOSED (FIST)" : "OPEN") : "Not Found";
    h2El.className = rightHand && rightHand.isClosed ? "text-glow" : "";
    
    // Face spotlight count
    if (facesEl) facesEl.innerText = latestFaces.length > 0 ? `${latestFaces.length} ✦` : '0';
  } else {
    document.body.classList.remove("camera-active");
    dot.className = "fa-solid fa-circle";
    text.innerText = "OFFLINE";
    handsCountEl.innerText = "0 / 2";
    h1El.innerText = "Not Found";
    h2El.innerText = "Not Found";
    h1El.className = "";
    h2El.className = "";
    if (facesEl) facesEl.innerText = '0';
  }
}

// Calculate visual Frame Rate
function calculateFPS(timestamp) {
  frameCount++;
  if (timestamp > lastFpsUpdate + 1000) {
    fps = Math.round((frameCount * 1000) / (timestamp - lastFpsUpdate));
    document.getElementById("fps-counter").innerText = fps;
    frameCount = 0;
    lastFpsUpdate = timestamp;
  }
}

// Build Sidebar Preset Gallery Elements Dynamically
function renderPresetList() {
  const container = document.getElementById("preset-list-container");
  container.innerHTML = '';
  
  VISUAL_PRESETS.forEach((preset, idx) => {
    const item = document.createElement("div");
    item.className = "preset-item";
    if (idx === effectsManager.activePresetIndex) {
      item.classList.add("active");
    }
    item.setAttribute("data-preset", idx);
    
    const indexStr = (idx + 1).toString().padStart(2, '0');
    
    item.innerHTML = `
      <div class="preset-index">${indexStr}</div>
      <div class="preset-info">
        <h3><i class="${preset.icon}"></i> ${preset.name}</h3>
        <p>${preset.description}</p>
      </div>
      <div class="preset-active-indicator"><i class="fa-solid fa-circle-check"></i></div>
    `;
    
    item.addEventListener("click", () => {
      if (Date.now() > globalCooldown && effectsManager.activePresetIndex !== idx) {
        effectsManager.startTransition(idx, transitionDuration);
        setActivePresetStyle(idx);
      }
    });
    
    container.appendChild(item);
  });
  
  document.getElementById("hud-preset-name").innerText = VISUAL_PRESETS[effectsManager.activePresetIndex].name.toUpperCase();
}

// Register UI Interactivity Event Listeners
function initUIListeners() {
  // Start Camera buttons
  const btnCamera = document.getElementById("btn-camera");
  const btnStartNow = document.getElementById("btn-start-now");
  
  btnCamera.addEventListener("click", toggleCamera);
  btnStartNow.addEventListener("click", () => {
    document.getElementById("onboarding-overlay").classList.add("fade-out");
    soundSynth.init();
    toggleCamera();
  });
  
  // Device Selection Select List
  const cameraSelect = document.getElementById("camera-select");
  cameraSelect.addEventListener("change", (e) => {
    if (e.target.value) {
      startCameraStream(e.target.value);
    }
  });
  
  // Skeleton Toggle
  const chkSkeleton = document.getElementById("chk-skeleton");
  chkSkeleton.addEventListener("change", (e) => {
    showSkeleton = e.target.checked;
  });
  
  // Mirror Toggle
  const chkMirror = document.getElementById("chk-mirror");
  chkMirror.addEventListener("change", (e) => {
    isMirror = e.target.checked;
  });
  
  // Filter Intensity Slider
  const sldParticles = document.getElementById("sld-particles");
  const valParticles = document.getElementById("val-particles");
  sldParticles.addEventListener("input", (e) => {
    effectIntensity = parseInt(e.target.value);
    valParticles.innerText = `${effectIntensity}%`;
  });
  
  // Transition Fade Duration Slider
  const sldTransition = document.getElementById("sld-transition");
  const valTransition = document.getElementById("val-transition");
  sldTransition.addEventListener("input", (e) => {
    transitionDuration = parseInt(e.target.value);
    valTransition.innerText = `${(transitionDuration / 1000).toFixed(1)}s`;
  });
  
  // Record Button
  const btnRecord = document.getElementById("btn-record");
  btnRecord.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      startRecording();
    }
  });
}

// Toggle Webcam Camera Stream
async function toggleCamera() {
  const btn = document.getElementById("btn-camera");
  
  if (isCamActive) {
    stopCamera();
    btn.innerHTML = '<i class="fa-solid fa-video"></i> <span>Initialize Camera</span>';
    btn.className = "btn btn-primary btn-glow";
  } else {
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Starting camera...</span>';
    btn.disabled = true;
    
    const success = await initCamera();
    
    btn.disabled = false;
    if (success) {
      btn.innerHTML = '<i class="fa-solid fa-video-slash"></i> <span>Disconnect Camera</span>';
      btn.className = "btn btn-glow";
    } else {
      btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span>Retry Camera</span>';
      btn.className = "btn btn-primary btn-glow";
    }
  }
}

// Enumerate local video cameras and select stream
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    
    stream.getTracks().forEach(track => track.stop());
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    const cameraSelect = document.getElementById("camera-select");
    cameraSelect.innerHTML = '';
    
    if (videoDevices.length === 0) {
      alert("No video devices detected on this system.");
      return false;
    }
    
    videoDevices.forEach(device => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Camera ${cameraSelect.length + 1}`;
      cameraSelect.add(option);
    });
    
    cameraSelect.disabled = false;
    
    const selectedDeviceId = videoDevices[0].deviceId;
    await startCameraStream(selectedDeviceId);
    
    initMediaPipeHands();
    
    isCamActive = true;
    return true;
  } catch (err) {
    console.error("Camera access failed:", err);
    alert("Webcam permission denied or camera not found. Please verify permissions and reload.");
    return false;
  }
}

// Start actual stream and bind to hidden video element
async function startCameraStream(deviceId) {
  if (videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(track => track.stop());
  }
  
  try {
    const constraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
    
    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play();
        resolve();
      };
    });
    
    if (cameraHelper) {
      await cameraHelper.stop();
    }
    
    cameraHelper = new Camera(videoElement, {
      onFrame: async () => {
        if (isCamActive) {
          await hands.send({ image: videoElement });
        }
      },
      width: 640,
      height: 480
    });
    
    cameraHelper.start();
  } catch (err) {
    console.error("Error starting camera stream:", err);
  }
}

// Initialize MediaPipe Hands model
let hands;
function initMediaPipeHands() {
  if (hands) return;
  
  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.65,
    minTrackingConfidence: 0.65
  });
  
  hands.onResults(onHandResults);
}

// Stop and disconnect webcam stream
function stopCamera() {
  // Stop any active recording first
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
  }
  
  isCamActive = false;
  latestHandsData = [];
  latestFaces = [];
  
  if (cameraHelper) {
    cameraHelper.stop();
    cameraHelper = null;
  }
  
  if (videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(track => track.stop());
    videoElement.srcObject = null;
  }
  
  document.getElementById("camera-select").disabled = true;
  document.getElementById("camera-select").innerHTML = '<option value="">Camera not initialized</option>';
}
// Enumerate available microphone devices — requests audio permission first so labels are populated
async function populateMicList() {
  const micSelect = document.getElementById('mic-select');
  try {
    // Request mic permission upfront so enumerateDevices returns real labels
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(t => t.stop()); // immediately release
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');
    micSelect.innerHTML = '';
    
    const noMicOption = document.createElement('option');
    noMicOption.value = 'none';
    noMicOption.text = '\uD83D\uDD07 No Mic';
    micSelect.add(noMicOption);
    
    mics.forEach((mic, idx) => {
      const option = document.createElement('option');
      option.value = mic.deviceId;
      option.text = mic.label || `\uD83C\uDF99 Microphone ${idx + 1}`;
      micSelect.add(option);
    });
    
    if (mics.length > 0) {
      micSelect.value = mics[0].deviceId;
    }
  } catch (err) {
    console.warn('Could not access audio devices:', err);
    micSelect.innerHTML = '<option value="none">\uD83D\uDD07 No Mic (permission denied)</option>';
  }
}

// Start video + audio recording
async function startRecording() {
  if (!isCamActive) {
    alert('Please start the camera first before recording.');
    return;
  }
  
  recordedChunks = [];
  
  // Build a combined MediaStream: canvas video + mic audio
  const canvasStream = canvasElement.captureStream(30);
  const combinedStream = new MediaStream();
  canvasStream.getVideoTracks().forEach(t => combinedStream.addTrack(t));
  
  // Set up AudioContext mixer — MUST resume before use (browsers suspend by default)
  soundSynth.init();
  const audioCtx = soundSynth.ctx;
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  const mixDest = audioCtx.createMediaStreamDestination();
  mixedAudioDestination = mixDest;
  soundSynth._mixDest = mixDest;
  
  // Try to get microphone audio
  const micSelect = document.getElementById('mic-select');
  const selectedMicId = micSelect.value;
  
  if (selectedMicId && selectedMicId !== 'none') {
    try {
      const micConstraints = {
        audio: selectedMicId
          ? { deviceId: { exact: selectedMicId }, echoCancellation: true, noiseSuppression: true }
          : true
      };
      const micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
      // Route mic into the AudioContext mixer
      const micSource = audioCtx.createMediaStreamSource(micStream);
      const micGain = audioCtx.createGain();
      micGain.gain.value = 1.0;
      micSource.connect(micGain);
      micGain.connect(mixDest);
      
      // Store so we can stop mic tracks on recording stop
      soundSynth._micStream = micStream;
    } catch (err) {
      console.warn('Microphone access failed, recording without mic audio:', err);
    }
  }
  
  // Add mixed audio track to combined stream
  mixDest.stream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
  
  // Determine best supported codec
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';
  
  try {
    mediaRecorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 5_000_000 });
  } catch (e) {
    mediaRecorder = new MediaRecorder(combinedStream);
  }
  
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };
  
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    
    // Show download link
    const downloadLink = document.getElementById('download-link');
    downloadLink.href = url;
    
    // Use timestamp in filename
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadLink.download = `gradcam-${ts}.webm`;
    downloadLink.style.display = 'flex';
    
    // Update status
    document.getElementById('rec-status').innerText = 'Saved!';
    
    // Clean up mic tracks
    if (soundSynth._micStream) {
      soundSynth._micStream.getTracks().forEach(t => t.stop());
      soundSynth._micStream = null;
    }
  };
  
  mediaRecorder.start(200); // collect data every 200ms
  recordingStartTime = Date.now();
  
  // Update UI
  const recordBar = document.getElementById('record-bar');
  recordBar.classList.add('recording');
  const viewfinder = document.querySelector('.camera-viewfinder');
  if (viewfinder) viewfinder.classList.add('recording');
  document.getElementById('btn-record-label').innerText = 'STOP';
  document.getElementById('rec-status').innerText = 'Recording...';
  document.getElementById('download-link').style.display = 'none';
  
  // Start timer
  recordTimerInterval = setInterval(updateRecordTimer, 1000);
  updateRecordTimer();
}

// Stop recording and finalize
function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  
  mediaRecorder.stop();
  
  // Clear timer
  clearInterval(recordTimerInterval);
  recordTimerInterval = null;
  
  // Reset UI (onstop callback will finalize download)
  const recordBar = document.getElementById('record-bar');
  recordBar.classList.remove('recording');
  const viewfinder = document.querySelector('.camera-viewfinder');
  if (viewfinder) viewfinder.classList.remove('recording');
  document.getElementById('btn-record-label').innerText = 'REC';
  document.getElementById('rec-timer').innerText = '00:00';
  document.getElementById('rec-status').innerText = 'Processing...';
}

// Update the recording timer display
function updateRecordTimer() {
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  document.getElementById('rec-timer').innerText = `${mins}:${secs}`;
}

// ─── Face Detection ──────────────────────────────────────────────────────────

// Initialize the FaceDetector API (Chrome 74+ behind flag or via Origin Trial)
async function initFaceDetector() {
  try {
    if (!('FaceDetector' in window)) {
      console.info('FaceDetector API not available. Face spotlights disabled.');
      return;
    }
    faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 8 });
    console.info('FaceDetector API ready.');
    
    // Poll face detection at ~5 fps to keep it lightweight
    faceDetectInterval = setInterval(runFaceDetection, 200);
  } catch (err) {
    console.warn('FaceDetector init failed:', err);
  }
}

// Run one frame of face detection against the live video element
async function runFaceDetection() {
  if (!faceDetector || !isCamActive || faceDetectBusy) return;
  if (!videoElement || videoElement.readyState < 2) return;
  
  faceDetectBusy = true;
  try {
    const faces = await faceDetector.detect(videoElement);
    
    // Map from video coordinates to canvas coordinates
    const scaleX = canvasElement.width / videoElement.videoWidth;
    const scaleY = canvasElement.height / videoElement.videoHeight;
    
    latestFaces = faces.map(f => ({
      x: isMirror
        ? canvasElement.width - (f.boundingBox.x + f.boundingBox.width) * scaleX
        : f.boundingBox.x * scaleX,
      y: f.boundingBox.y * scaleY,
      w: f.boundingBox.width * scaleX,
      h: f.boundingBox.height * scaleY
    }));
  } catch (e) {
    latestFaces = [];
  } finally {
    faceDetectBusy = false;
  }
}

// Draw a soft warm spotlight glow around each detected face
function drawFaceSpotlights(ctx, cw, ch) {
  ctx.save();
  
  latestFaces.forEach(face => {
    const cx = face.x + face.w / 2;
    const cy = face.y + face.h / 2;
    const radius = Math.max(face.w, face.h) * 0.85;
    
    // Outer dark vignette-like dimmer on everything EXCEPT the face
    // Use 'destination-out' trick: not practical here, so instead draw
    // a soft radial spotlight that brightens the face area via 'overlay'
    
    // Layer 1: Screen-mode warm glow to lift the face brightness
    ctx.globalCompositeOperation = 'screen';
    const warmGlow = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.6);
    warmGlow.addColorStop(0,   'rgba(255, 240, 200, 0.18)');
    warmGlow.addColorStop(0.4, 'rgba(255, 210, 150, 0.08)');
    warmGlow.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, 0, cw, ch);
    
    // Layer 2: Subtle rim halo ring around face
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.22;
    const rimGrad = ctx.createRadialGradient(cx, cy, radius * 0.75, cx, cy, radius * 0.9);
    rimGrad.addColorStop(0,   'rgba(255, 255, 220, 0)');
    rimGrad.addColorStop(0.5, 'rgba(255, 248, 200, 0.55)');
    rimGrad.addColorStop(1,   'rgba(255, 255, 255, 0)');
    ctx.fillStyle = rimGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.9, radius * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Layer 3: Tiny elegant face-center dot marker
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, face.w * 0.52, face.h * 0.56, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}
