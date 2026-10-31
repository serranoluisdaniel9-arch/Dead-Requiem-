/**
 * Procedural audio for Dead Strike Reborn.
 *
 * Everything is synthesised at runtime: no samples, no network requests, no
 * external assets. One AudioContext feeds a dry bus plus a short convolution
 * reverb built from a decaying noise impulse, which is what gives the street
 * its concrete-and-fog tail without shipping an impulse response file.
 *
 * Spatialisation is a plain StereoPannerNode driven by the caller: the game
 * knows where the player is looking, this module only knows left/right.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createAudioEngine() {
  let ctx = null;
  let dry = null;
  let reverbSend = null;
  let noise = null;
  let ambience = null;
  let enabled = true;

  function makeNoise(seconds) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function impulse(seconds, decay) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  function ensure() {
    if (ctx) return ctx;
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return null;
    try {
      ctx = new Audio();
    } catch (_) {
      return null;
    }
    dry = ctx.createGain();
    dry.gain.value = .85;
    dry.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(.9, 3.1);
    reverbSend = ctx.createGain();
    reverbSend.gain.value = .2;
    convolver.connect(reverbSend);
    reverbSend.connect(ctx.destination);
    ctx.__reverb = convolver;

    noise = makeNoise(2);
    return ctx;
  }

  /** A short filtered noise burst: the body of every gunshot and impact. */
  function burst({ at, duration, type, frequency, endFrequency, gain, pan, send }) {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    if (endFrequency) filter.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + .004);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(panner);
    panner.connect(dry);
    if (send > 0) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      panner.connect(sendGain);
      sendGain.connect(ctx.__reverb);
    }
    source.start(at);
    source.stop(at + duration + .02);
  }

  /** A pitched body: mechanical clicks, growls, the low end of a shotgun. */
  function tone({ at, duration, type, frequency, endFrequency, gain, pan, send }) {
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + .012);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    oscillator.connect(envelope);
    envelope.connect(panner);
    panner.connect(dry);
    if (send > 0) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      panner.connect(sendGain);
      sendGain.connect(ctx.__reverb);
    }
    oscillator.start(at);
    oscillator.stop(at + duration + .02);
  }

  function resume() {
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  /**
   * Street ambience: a low rumble plus band-passed wind, both looping, with a
   * slow LFO on the wind so it never sounds like a static hiss.
   */
  function startAmbience() {
    if (!ensure() || ambience) return;
    const at = ctx.currentTime;
    const rumble = ctx.createBufferSource();
    rumble.buffer = noise;
    rumble.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 120;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = .05;
    rumble.connect(lowpass).connect(rumbleGain).connect(dry);

    const wind = ctx.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 620;
    bandpass.Q.value = .7;
    const windGain = ctx.createGain();
    windGain.gain.value = .022;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = .07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = .012;
    lfo.connect(lfoGain).connect(windGain.gain);
    wind.connect(bandpass).connect(windGain).connect(dry);

    const sendGain = ctx.createGain();
    sendGain.gain.value = .3;
    windGain.connect(sendGain);
    sendGain.connect(ctx.__reverb);

    rumble.start(at);
    wind.start(at);
    lfo.start(at);
    ambience = { rumble, wind, lfo, rumbleGain, windGain };
  }

  function stopAmbience() {
    if (!ambience) return;
    try {
      ambience.rumble.stop();
      ambience.wind.stop();
      ambience.lfo.stop();
    } catch (_) { /* already stopped */ }
    ambience = null;
  }

  const WEAPON_VOICE = {
    pistol: { body: 2600, tail: 190, gain: .22, length: .13, thump: 120 },
    revolver: { body: 1900, tail: 150, gain: .3, length: .2, thump: 88 },
    smg: { body: 3200, tail: 240, gain: .16, length: .09, thump: 150 },
    shotgun: { body: 1200, tail: 110, gain: .34, length: .26, thump: 62 },
    rifle: { body: 2200, tail: 130, gain: .3, length: .22, thump: 74 },
    assault: { body: 2900, tail: 180, gain: .26, length: .11, thump: 110 },
    sniper: { body: 1600, tail: 80, gain: .42, length: .34, thump: 54 },
    flamethrower: { body: 1100, tail: 420, gain: .28, length: .16, thump: 65, isFlame: true },
  };

  function shot(weaponId = 'pistol', pan = 0) {
    if (!enabled || !ensure()) return;
    const at = ctx.currentTime;
    const voice = WEAPON_VOICE[weaponId] || WEAPON_VOICE.pistol;
    burst({
      at, duration: voice.length, type: 'lowpass',
      frequency: voice.body, endFrequency: voice.tail,
      gain: voice.gain, pan, send: .3,
    });
    tone({
      at, duration: voice.length * .8, type: 'triangle',
      frequency: voice.thump, endFrequency: voice.thump * .45,
      gain: voice.gain * .5, pan, send: .12,
    });
  }

  function impact(pan = 0, flesh = true) {
    if (!enabled || !ensure()) return;
    const at = ctx.currentTime;
    burst({
      at, duration: flesh ? .1 : .07, type: flesh ? 'lowpass' : 'highpass',
      frequency: flesh ? 900 : 2400, endFrequency: flesh ? 220 : 1200,
      gain: flesh ? .16 : .1, pan, send: .18,
    });
    if (flesh) {
      tone({ at, duration: .12, type: 'sine', frequency: 96, endFrequency: 48, gain: .1, pan, send: .1 });
    }
  }

  function reload(pan = 0) {
    if (!enabled || !ensure()) return;
    const at = ctx.currentTime;
    // Magazine out, magazine in, slide: three mechanical clicks.
    for (const [offset, frequency, gain] of [[0, 1400, .07], [.16, 900, .08], [.34, 1800, .06]]) {
      burst({ at: at + offset, duration: .05, type: 'bandpass', frequency, gain, pan, send: .1 });
      tone({ at: at + offset, duration: .05, type: 'square', frequency: frequency * .5, gain: gain * .35, pan, send: 0 });
    }
  }

  function step(pan = 0, strength = 1) {
    if (!enabled || !ensure()) return;
    const at = ctx.currentTime;
    burst({
      at, duration: .09, type: 'lowpass', frequency: 700, endFrequency: 180,
      gain: .05 * strength, pan, send: .12,
    });
  }

  function growl(pan = 0, distance = 10) {
    if (!enabled || !ensure()) return;
    const at = ctx.currentTime;
    const near = clamp(1 - distance / 26, .12, 1);
    tone({
      at, duration: .7, type: 'sawtooth',
      frequency: 58, endFrequency: 36,
      gain: .05 * near, pan, send: .35,
    });
    burst({
      at, duration: .5, type: 'lowpass', frequency: 240, endFrequency: 120,
      gain: .03 * near, pan, send: .3,
    });
  }

  function hurt(pan = 0) {
    if (!enabled || !ensure()) return;
    const at = ctx.currentTime;
    tone({ at, duration: .3, type: 'sawtooth', frequency: 150, endFrequency: 60, gain: .12, pan, send: .2 });
    burst({ at, duration: .18, type: 'lowpass', frequency: 500, endFrequency: 140, gain: .1, pan, send: .15 });
  }

  function pickup(pan = 0) {
    if (!enabled || !ensure()) return;
    const at = ctx.currentTime;
    tone({ at, duration: .1, type: 'sine', frequency: 620, endFrequency: 900, gain: .07, pan, send: .2 });
    tone({ at: at + .09, duration: .12, type: 'sine', frequency: 900, endFrequency: 1240, gain: .05, pan, send: .2 });
  }

  function ui(kind = 'click') {
    if (!enabled || !ensure()) return;
    const at = ctx.currentTime;
    tone({
      at, duration: kind === 'buy' ? .16 : .07, type: 'triangle',
      frequency: kind === 'buy' ? 520 : 760,
      endFrequency: kind === 'buy' ? 880 : 620,
      gain: .05, pan: 0, send: .1,
    });
  }

  return {
    resume,
    startAmbience,
    stopAmbience,
    shot,
    impact,
    reload,
    step,
    growl,
    hurt,
    pickup,
    ui,
    get enabled() { return enabled; },
    set enabled(value) {
      enabled = Boolean(value);
      if (!enabled) stopAmbience();
    },
    get available() { return Boolean(ctx); },
  };
}
