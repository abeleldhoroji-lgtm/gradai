/**
 * GradCam - Visual Effects Engine (Cinematic Filters Refactored)
 * Implements 8 full-screen filters and a double-buffered cross-fade transition system.
 */

class EffectsManager {
  constructor() {
    this.activePresetIndex = 0;
    this.prevPresetIndex = 0;
    
    // Cross-fade state
    this.isTransitioning = false;
    this.transitionProgress = 0;
    this.transitionDuration = 500; // ms
    
    // Offscreen rendering buffers to support smooth cross-fading
    this.canvasA = document.createElement('canvas');
    this.ctxA = this.canvasA.getContext('2d');
    this.canvasB = document.createElement('canvas');
    this.ctxB = this.canvasB.getContext('2d');
    
    // Utility buffer for color-channel splitting (Chromatic Aberration)
    this.channelCanvas = document.createElement('canvas');
    this.channelCtx = this.channelCanvas.getContext('2d');
    
    // Dust particles for Golden Hour / Vintage filter
    this.dustParticles = [];
    this.initDust();
    
    this.hueShift = 0;
  }
  
  initDust() {
    this.dustParticles = [];
    for (let i = 0; i < 30; i++) {
      this.dustParticles.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0008,
        vy: -0.0004 - Math.random() * 0.0008, // float upwards
        size: 1 + Math.random() * 2.5,
        alpha: 0.15 + Math.random() * 0.35,
        pulse: Math.random() * Math.PI
      });
    }
  }

  syncOffscreenSize(width, height) {
    if (this.canvasA.width !== width || this.canvasA.height !== height) {
      this.canvasA.width = width;
      this.canvasA.height = height;
      this.canvasB.width = width;
      this.canvasB.height = height;
      this.channelCanvas.width = width;
      this.channelCanvas.height = height;
    }
  }

  // Set transition parameters and start cross-fade
  startTransition(nextIdx, durationMs) {
    if (this.isTransitioning) {
      // If already transitioning, instantly finish and start next
      this.prevPresetIndex = this.activePresetIndex;
    } else {
      this.prevPresetIndex = this.activePresetIndex;
    }
    
    this.activePresetIndex = nextIdx;
    this.transitionProgress = 0;
    this.isTransitioning = true;
    this.transitionDuration = durationMs;
  }

  // Update physics/timers
  update(hands, canvasWidth, canvasHeight, intensity, elapsed) {
    this.hueShift = (this.hueShift + 0.5) % 360;
    
    // 1. Update transition progress
    if (this.isTransitioning) {
      this.transitionProgress += elapsed / this.transitionDuration;
      if (this.transitionProgress >= 1.0) {
        this.transitionProgress = 1.0;
        this.isTransitioning = false;
      }
    }
    
    // 2. Update Golden Hour dust specs
    this.dustParticles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += 0.02;
      
      // Wrap-around bounds check
      if (p.x < 0) p.x = 1.0;
      if (p.x > 1.0) p.x = 0;
      if (p.y < 0) p.y = 1.0;
      if (p.y > 1.0) p.y = 0;
      
      // Spawn dust reaction on fast hand movement
      hands.forEach(hand => {
        const hx = hand.palmCenter.x / canvasWidth;
        const hy = hand.palmCenter.y / canvasHeight;
        const dist = Math.hypot(p.x - hx, p.y - hy);
        if (dist < 0.15) {
          const angle = Math.atan2(p.y - hy, p.x - hx);
          const push = (0.15 - dist) * 0.05;
          p.x += Math.cos(angle) * push;
          p.y += Math.sin(angle) * push;
        }
      });
    });
  }

  // Render the overlays onto the main screen
  draw(ctx, canvasWidth, canvasHeight, showSkeleton, hands, videoElement) {
    this.syncOffscreenSize(canvasWidth, canvasHeight);
    
    if (this.isTransitioning) {
      // Double buffered cross-fade rendering
      
      // Draw old preset to Buffer A
      this.ctxA.clearRect(0, 0, canvasWidth, canvasHeight);
      this.drawPreset(this.prevPresetIndex, this.ctxA, canvasWidth, canvasHeight, hands, videoElement);
      
      // Draw new preset to Buffer B
      this.ctxB.clearRect(0, 0, canvasWidth, canvasHeight);
      this.drawPreset(this.activePresetIndex, this.ctxB, canvasWidth, canvasHeight, hands, videoElement);
      
      // Blend A and B onto screen
      ctx.drawImage(this.canvasA, 0, 0);
      
      ctx.save();
      ctx.globalAlpha = this.transitionProgress;
      ctx.drawImage(this.canvasB, 0, 0);
      ctx.restore();
    } else {
      // Single buffer direct draw
      this.drawPreset(this.activePresetIndex, ctx, canvasWidth, canvasHeight, hands, videoElement);
    }
    
    // Draw joint skeletal connections on top of filters if enabled
    if (showSkeleton && hands.length > 0) {
      this.drawSkeleton(ctx, hands, canvasWidth, canvasHeight);
    }
  }

  // Core drawing router for each of the 8 styles
  drawPreset(idx, ctx, w, h, hands, video) {
    // Fallback coordinates if no hand present (center-right area)
    const primaryHand = hands[0];
    const secondaryHand = hands[1];
    
    const h1 = primaryHand ? primaryHand.palmCenter : { x: w * 0.75, y: h * 0.35 };
    const h2 = secondaryHand ? secondaryHand.palmCenter : { x: w * 0.25, y: h * 0.65 };
    const handScale = primaryHand ? primaryHand.handSize : 80;

    switch (idx) {
      case 0: // 1. Dreamy Glow (Bloom)
        this.drawDreamyGlow(ctx, video, w, h, h1);
        break;
        
      case 1: // 2. Ambient Light Leaks
        this.drawAmbientLeaks(ctx, video, w, h, h1, h2);
        break;
        
      case 2: // 3. Solar Lens Flare
        this.drawSolarLensFlare(ctx, video, w, h, h1);
        break;
        
      case 3: // 4. Noir Spotlight
        this.drawNoirSpotlight(ctx, video, w, h, h1, handScale);
        break;
        
      case 4: // 5. Cosmic Nebula
        this.drawCosmicNebula(ctx, video, w, h, h1);
        break;
        
      case 5: // 6. Golden Hour / Vintage
        this.drawGoldenHour(ctx, video, w, h, h1);
        break;
        
      case 6: // 7. Prism Glass Split
        this.drawPrismSplit(ctx, video, w, h, h1);
        break;
        
      case 7: // 8. Teal & Orange Cinematic Grade
        this.drawTealOrangeGrade(ctx, video, w, h, h1);
        break;
    }
  }

  // 1. Dreamy Glow / Bloom Filter
  drawDreamyGlow(ctx, video, w, h, h1) {
    // Draw normal video frame
    ctx.drawImage(video, 0, 0, w, h);
    
    // Extract blur factor from hand position
    // Height controls blur radius (up is more blur)
    const blurRadius = Math.max(2, (1 - (h1.y / h)) * 24);
    // Horizontal positions control contrast/brightness boost
    const brightness = 1.0 + (h1.x / w) * 0.45;
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = `blur(${blurRadius}px) brightness(${brightness}) saturate(1.25)`;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
  }

  // 2. Ambient Light Leaks Filter
  drawAmbientLeaks(ctx, video, w, h, h1, h2) {
    ctx.drawImage(video, 0, 0, w, h);
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    const time = Date.now() / 1500;
    
    // Gradient A (Violet) - follows primary hand with float drift
    const driftX1 = Math.sin(time) * 40;
    const driftY1 = Math.cos(time) * 40;
    const rad1 = ctx.createRadialGradient(
      h1.x + driftX1, h1.y + driftY1, 20,
      h1.x + driftX1, h1.y + driftY1, w * 0.55
    );
    rad1.addColorStop(0, 'rgba(178, 0, 255, 0.4)');
    rad1.addColorStop(0.5, 'rgba(120, 0, 255, 0.12)');
    rad1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = rad1;
    ctx.fillRect(0, 0, w, h);
    
    // Gradient B (Cyan/Blue) - follows secondary hand or secondary coordinates
    const driftX2 = Math.cos(time * 0.7) * 50;
    const driftY2 = Math.sin(time * 0.7) * 50;
    const rad2 = ctx.createRadialGradient(
      h2.x + driftX2, h2.y + driftY2, 10,
      h2.x + driftX2, h2.y + driftY2, w * 0.45
    );
    rad2.addColorStop(0, 'rgba(0, 242, 254, 0.35)');
    rad2.addColorStop(0.5, 'rgba(0, 100, 255, 0.1)');
    rad2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = rad2;
    ctx.fillRect(0, 0, w, h);
    
    // Constant corner glow (Warm amber light leak at top left)
    const rad3 = ctx.createRadialGradient(
      0, 0, 0,
      0, 0, w * 0.5
    );
    rad3.addColorStop(0, 'rgba(255, 120, 0, 0.25)');
    rad3.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rad3;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
  }

  // 3. Solar Lens Flare
  drawSolarLensFlare(ctx, video, w, h, h1) {
    ctx.drawImage(video, 0, 0, w, h);
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    const cx = w / 2;
    const cy = h / 2;
    
    // 1. Primary Glow core centered at hand
    const sunGrad = ctx.createRadialGradient(
      h1.x, h1.y, 2,
      h1.x, h1.y, 180
    );
    sunGrad.addColorStop(0, '#ffffff');
    sunGrad.addColorStop(0.1, 'rgba(255, 230, 160, 0.9)');
    sunGrad.addColorStop(0.4, 'rgba(255, 170, 0, 0.3)');
    sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(h1.x, h1.y, 250, 0, Math.PI*2);
    ctx.fill();
    
    // Draw sunburst rays (thin line hashes radiating out)
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.06)';
    ctx.lineWidth = 1;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 18) {
      ctx.beginPath();
      ctx.moveTo(h1.x, h1.y);
      ctx.lineTo(h1.x + Math.cos(angle) * w, h1.y + Math.sin(angle) * w);
      ctx.stroke();
    }
    
    // 2. Lens Flare Rings & Bokeh Circles along the vector to screen center
    // Vector: h1 to screen center
    const dx = cx - h1.x;
    const dy = cy - h1.y;
    
    const flareNodes = [
      { pos: 0.3, size: 28, color: 'rgba(0, 242, 254, 0.15)', type: 'ring' },
      { pos: 0.5, size: 12, color: 'rgba(255, 0, 100, 0.12)', type: 'solid' },
      { pos: 0.8, size: 45, color: 'rgba(255, 170, 0, 0.08)', type: 'solid' },
      { pos: 1.2, size: 60, color: 'rgba(0, 242, 254, 0.05)', type: 'ring' },
      { pos: 1.4, size: 20, color: 'rgba(120, 0, 255, 0.1)', type: 'solid' },
      { pos: -0.4, size: 85, color: 'rgba(255, 255, 255, 0.02)', type: 'solid' }
    ];
    
    flareNodes.forEach(node => {
      const fx = h1.x + dx * node.pos;
      const fy = h1.y + dy * node.pos;
      
      ctx.beginPath();
      ctx.arc(fx, fy, node.size, 0, Math.PI * 2);
      
      if (node.type === 'solid') {
        const grad = ctx.createRadialGradient(fx, fy, 2, fx, fy, node.size);
        grad.addColorStop(0, node.color);
        grad.addColorStop(0.8, node.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fill();
      } else {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
    
    ctx.restore();
  }

  // 4. Noir Spotlight (Revealing color spotlight on grayscale background)
  drawNoirSpotlight(ctx, video, w, h, h1, handScale) {
    // 1. Draw high contrast grayscale video over canvas
    ctx.save();
    ctx.filter = "grayscale(100%) contrast(1.35) brightness(0.8)";
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    
    // 2. Setup feathered offscreen mask
    this.channelCtx.clearRect(0, 0, w, h);
    this.channelCtx.drawImage(video, 0, 0, w, h);
    
    // Draw feathered mask using destination-in
    this.channelCtx.save();
    this.channelCtx.globalCompositeOperation = 'destination-in';
    
    const spotSize = Math.max(100, handScale * 2.8);
    const grad = this.channelCtx.createRadialGradient(
      h1.x, h1.y, spotSize * 0.3,
      h1.x, h1.y, spotSize
    );
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    
    this.channelCtx.fillStyle = grad;
    this.channelCtx.fillRect(0, 0, w, h);
    this.channelCtx.restore();
    
    // 3. Draw color spotlight overlay onto screen
    ctx.drawImage(this.channelCanvas, 0, 0);
    
    // Draw a decorative HUD circle around spotlight
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(h1.x, h1.y, spotSize * 0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 5. Cosmic Nebula
  drawCosmicNebula(ctx, video, w, h, h1) {
    // 1. Base graded video
    ctx.save();
    ctx.filter = "saturate(1.2) contrast(1.1) brightness(0.9)";
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    const time = Date.now() / 1000;
    
    // 2. Multi-colored gaseous Nebula clouds centered at hand
    // Violet gas
    const radViolet = ctx.createRadialGradient(
      h1.x + Math.sin(time) * 30, h1.y + Math.cos(time) * 30, 10,
      h1.x, h1.y, w * 0.4
    );
    radViolet.addColorStop(0, 'rgba(150, 0, 255, 0.35)');
    radViolet.addColorStop(0.5, 'rgba(80, 0, 180, 0.12)');
    radViolet.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radViolet;
    ctx.fillRect(0, 0, w, h);
    
    // Cyan gas
    const radCyan = ctx.createRadialGradient(
      h1.x + Math.cos(time * 0.7) * 40, h1.y + Math.sin(time * 0.7) * 40, 5,
      h1.x, h1.y, w * 0.3
    );
    radCyan.addColorStop(0, 'rgba(0, 242, 254, 0.3)');
    radCyan.addColorStop(0.6, 'rgba(0, 120, 255, 0.08)');
    radCyan.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radCyan;
    ctx.fillRect(0, 0, w, h);
    
    // Magenta core
    const radMagenta = ctx.createRadialGradient(
      h1.x, h1.y, 2,
      h1.x, h1.y, w * 0.18
    );
    radMagenta.addColorStop(0, 'rgba(255, 0, 180, 0.45)');
    radMagenta.addColorStop(0.5, 'rgba(255, 0, 100, 0.15)');
    radMagenta.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radMagenta;
    ctx.fillRect(0, 0, w, h);
    
    // 3. Twinkling cosmic stars (bokeh / lens flare elements)
    const offsets = [
      { dx: -50, dy: -30, size: 8, speed: 1 },
      { dx: 60, dy: 40, size: 12, speed: 1.2 },
      { dx: -30, dy: 60, size: 6, speed: 0.8 },
      { dx: 70, dy: -50, size: 10, speed: 1.5 },
      { dx: -80, dy: 20, size: 14, speed: 0.7 },
      { dx: 20, dy: -70, size: 5, speed: 1.3 }
    ];
    
    offsets.forEach(star => {
      const pulse = 0.5 + Math.sin(time * 3 * star.speed) * 0.5;
      const sx = h1.x + star.dx;
      const sy = h1.y + star.dy;
      const size = star.size * pulse;
      
      // Draw a glowing flare star (plus shape + core)
      const starGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * 1.5);
      starGrad.addColorStop(0, '#ffffff');
      starGrad.addColorStop(0.3, 'rgba(0, 242, 254, 0.8)');
      starGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = starGrad;
      
      ctx.beginPath();
      ctx.arc(sx, sy, size * 1.5, 0, Math.PI * 2);
      ctx.fill();
      
      // Star spikes
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - size * 2.2, sy);
      ctx.lineTo(sx + size * 2.2, sy);
      ctx.moveTo(sx, sy - size * 2.2);
      ctx.lineTo(sx, sy + size * 2.2);
      ctx.stroke();
    });
    
    // 4. White hot core
    const coreGrad = ctx.createRadialGradient(h1.x, h1.y, 0, h1.x, h1.y, 8);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(h1.x, h1.y, 8, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }

  // 6. Golden Hour / Vintage Film
  drawGoldenHour(ctx, video, w, h, h1) {
    // Graded video base
    ctx.save();
    ctx.filter = "sepia(45%) saturate(130%) brightness(0.95) contrast(1.1)";
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    // Sun ray gradients centered at hand
    const rayGrad = ctx.createRadialGradient(
      h1.x, h1.y, 0,
      h1.x, h1.y, w * 0.7
    );
    rayGrad.addColorStop(0, 'rgba(255, 160, 45, 0.4)');
    rayGrad.addColorStop(0.4, 'rgba(255, 110, 20, 0.15)');
    rayGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rayGrad;
    ctx.fillRect(0, 0, w, h);
    
    // Draw floating dust spec particles
    this.dustParticles.forEach(p => {
      const px = p.x * w;
      const py = p.y * h;
      
      ctx.beginPath();
      // Pulsate opacity slightly
      ctx.globalAlpha = p.alpha * (0.6 + Math.sin(p.pulse) * 0.4);
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fillStyle = '#ffeed0';
      ctx.shadowBlur = p.size * 2;
      ctx.shadowColor = '#ffa030';
      ctx.fill();
    });
    
    ctx.restore();
  }

  // 7. Prism Glass Split Refraction
  drawPrismSplit(ctx, video, w, h, h1) {
    // 1. Draw base video frame
    ctx.drawImage(video, 0, 0, w, h);
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.22;
    
    const cx = w / 2;
    const cy = h / 2;
    
    // Refraction distance scales with hand distance from center
    const refractDist = Math.min(60, Math.hypot(h1.x - cx, h1.y - cy) * 0.15);
    
    // Render 3 triangular refractive prism shards
    for (let i = 0; i < 3; i++) {
      const angle = (Math.PI * 2 / 3) * i + (Date.now() / 1000 * 0.1);
      const dx = Math.cos(angle) * refractDist;
      const dy = Math.sin(angle) * refractDist;
      
      ctx.save();
      // Design a diamond clipping path centered on the hand
      ctx.beginPath();
      ctx.moveTo(h1.x + dx, h1.y + dy - 180);
      ctx.lineTo(h1.x + dx + 140, h1.y + dy);
      ctx.lineTo(h1.x + dx, h1.y + dy + 180);
      ctx.lineTo(h1.x + dx - 140, h1.y + dy);
      ctx.closePath();
      ctx.clip();
      
      // Draw translated video shifted slightly
      ctx.drawImage(video, dx * 1.5, dy * 1.5, w, h);
      
      // Prism border glint
      ctx.strokeStyle = `rgba(255, 255, 255, 0.4)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    
    ctx.restore();
  }

  // 8. Teal & Orange Cinematic Grade
  drawTealOrangeGrade(ctx, video, w, h, h1) {
    // 1. Draw graded video base with high saturation and contrast
    ctx.save();
    ctx.filter = "saturate(1.25) contrast(1.15) brightness(0.95)";
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    
    ctx.save();
    
    // 2. Overlay linear split-toning gradient
    // Hand X shifts the center point of the gradient split
    // Hand Y shifts the strength/opacity of the grade
    const splitPercent = h1.x / w;
    const gradeOpacity = 0.35 + (1 - (h1.y / h)) * 0.25; // range 0.35 to 0.60
    
    const linearGrad = ctx.createLinearGradient(0, 0, w, 0);
    // Cool Teal in shadows (left side)
    linearGrad.addColorStop(0, 'rgba(0, 95, 115, 0.45)');
    linearGrad.addColorStop(Math.max(0, splitPercent - 0.15), 'rgba(0, 95, 115, 0.15)');
    // Warm Amber/Orange in highlights (right side)
    linearGrad.addColorStop(Math.min(1.0, splitPercent + 0.15), 'rgba(238, 155, 0, 0.15)');
    linearGrad.addColorStop(1.0, 'rgba(202, 103, 2, 0.45)');
    
    ctx.globalAlpha = gradeOpacity;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = linearGrad;
    ctx.fillRect(0, 0, w, h);
    
    // 3. Draw a soft, warm amber highlight leak following the hand location to enhance aesthetics
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.25;
    const leakGrad = ctx.createRadialGradient(
      h1.x, h1.y, 10,
      h1.x, h1.y, w * 0.35
    );
    leakGrad.addColorStop(0, 'rgba(255, 170, 50, 0.5)');
    leakGrad.addColorStop(0.5, 'rgba(255, 110, 20, 0.15)');
    leakGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = leakGrad;
    ctx.fillRect(0, 0, w, h);
    
    ctx.restore();
  }


  // Draw technological wires linking joint positions
  drawSkeleton(ctx, hands, width, height) {
    ctx.save();
    
    // Resolve the CSS custom property to an actual color value (canvas doesn't understand var())
    const themeColor = getComputedStyle(document.body).getPropertyValue('--theme-color').trim() || '#ffffff';
    const themeRgb = this.hexToRgb(themeColor);
    
    ctx.strokeStyle = `rgba(${themeRgb}, 0.22)`;
    ctx.shadowBlur = 3;
    ctx.shadowColor = `rgba(${themeRgb}, 0.22)`;
    
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [9, 10], [10, 11], [11, 12],     // Middle
      [13, 14], [14, 15], [15, 16],    // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [5, 9], [9, 13], [13, 17]        // Knuckle joins
    ];

    hands.forEach(hand => {
      // Draw wires
      ctx.lineWidth = 1.0;
      connections.forEach(([start, end]) => {
        const pt1 = hand.landmarks[start];
        const pt2 = hand.landmarks[end];
        ctx.beginPath();
        ctx.moveTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.stroke();
      });

      // Draw nodes
      hand.landmarks.forEach((pt, id) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, id === 8 || id === 4 || id === 12 || id === 16 || id === 20 ? 3.5 : 1.5, 0, Math.PI*2);
        
        if (id === 8 || id === 12) {
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 10;
          ctx.shadowColor = themeColor;
        } else {
          ctx.fillStyle = themeColor;
          ctx.shadowBlur = 3;
          ctx.shadowColor = themeColor;
        }
        ctx.fill();
      });
    });

    ctx.restore();
  }

  hexToRgb(hex) {
    hex = hex.replace(/^\s*#|\s*$/g, '');
    if (hex.length === 3) {
      hex = hex.replace(/(.)/g, '$1$1');
    }
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return `${r}, ${g}, ${b}`;
  }
}

// Cinematic presets metadata
const VISUAL_PRESETS = [
  {
    name: "Dreamy Glow",
    themeClass: "theme-glow",
    icon: "fa-solid fa-cloud-sun",
    description: "Cinematic bloom softening light areas. Height shapes blur radius; horizontal maps exposure."
  },
  {
    name: "Ambient Leaks",
    themeClass: "theme-ambient",
    icon: "fa-solid fa-palette",
    description: "Anamorphic color leaks drifting on screen. Hand positions attract neon light leaks."
  },
  {
    name: "Solar Flare",
    themeClass: "theme-sunglare",
    icon: "fa-solid fa-sun",
    description: "Bright sun glare reflecting along optical bokeh paths following your hand coordinates."
  },
  {
    name: "Noir Spotlight",
    themeClass: "theme-noir",
    icon: "fa-solid fa-lightbulb",
    description: "Grayscale feed with a soft, circular color spotlight track matching your palm center."
  },
  {
    name: "Cosmic Nebula",
    themeClass: "theme-nebula",
    icon: "fa-solid fa-meteor",
    description: "Interstellar gaseous clouds and twinkling stars tracking your palm center coordinates."
  },
  {
    name: "Golden Vintage",
    themeClass: "theme-golden",
    icon: "fa-solid fa-clock",
    description: "Warm amber vintage grading overlay with floating dust specs reacting to hand movement."
  },
  {
    name: "Prism Glass",
    themeClass: "theme-prism",
    icon: "fa-solid fa-gem",
    description: "Multi-layered refraction mimicking glass prisms. Shifts refractive index on hand tilt."
  },
  {
    name: "Teal & Orange",
    themeClass: "theme-tealorange",
    icon: "fa-solid fa-film",
    description: "Hollywood cinematic grade. Sliding hand shifts color balance between teal shadows and orange highlights."
  }
];

window.EffectsManager = EffectsManager;
window.VISUAL_PRESETS = VISUAL_PRESETS;
