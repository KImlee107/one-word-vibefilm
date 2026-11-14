"""Analyze decoded mono f32 PCM; no models, network, music synthesis or stem claims.
Usage: python tools/analyze-default-music.py input.f32 output.js
Decode the user-provided audio at 8 kHz with ffmpeg before calling this tool.
Optional offline dependencies: numpy, scipy. Not needed by the website runtime.
"""
import json, sys, hashlib
from pathlib import Path
import numpy as np
from scipy import signal

x = np.fromfile(sys.argv[1], dtype='float32')
sr, hop, nfft = 8000, 128, 1024
duration = len(x) / sr
f, times, spectrum = signal.stft(x, sr, nperseg=nfft, noverlap=nfft-hop, boundary=None)
bands = (f > 35) & (f < 3500)
log_magnitude = np.log1p(abs(spectrum[bands])*150)
flux = np.maximum(0, np.diff(log_magnitude, axis=1)).mean(axis=0)
flux = np.maximum(0, flux-np.percentile(flux, 35))
flux = signal.convolve(flux, [.2,.6,.2], mode='same')
dt = hop/sr
peaks, _ = signal.find_peaks(flux, distance=9, prominence=np.percentile(flux,75)*.45)
onsets, strengths = peaks*dt + times[1], flux[peaks]
centered = flux-flux.mean()
correlation = signal.fftconvolve(centered, centered[::-1], mode='full')[len(flux)-1:]
correlation /= max(1e-12, correlation[0])
low, high = int(60/180/dt), int(60/60/dt)
lag = low+int(np.argmax(correlation[low:high+1]))
rough_bpm = 60/(lag*dt)
active = (onsets > 3) & (onsets < min(duration-16,170))
t, s = onsets[active], strengths[active]
fits = []
for bpm in np.arange(rough_bpm-2, rough_bpm+2, .002):
    vector = np.sum(s*np.exp(2j*np.pi*t*bpm/60))
    fits.append((abs(vector)/sum(s), float(bpm), vector))
coherence, bpm, vector = max(fits, key=lambda v:v[0])
period = 60/bpm
phase = (float(np.angle(vector))/(2*np.pi)*period) % period
subdivision_coherence = abs(np.sum(s*np.exp(4j*np.pi*t/period)))/sum(s)
beats, weights, residuals = [], [], []
for target in np.arange(phase,duration,period):
    j = int(np.argmin(abs(onsets-target)))
    if abs(onsets[j]-target) < .095 and strengths[j] > max(strengths)*.045:
        beats.append(round(float(onsets[j]),3))
        weights.append(round(float(strengths[j]/max(strengths)),3))
        residuals.append(abs(onsets[j]-target))
alignment = max(0,1-float(np.mean(residuals))/.095)
confidence = min(1,.5*float(correlation[lag])+.3*float(subdivision_coherence)+.2*alignment)
if confidence < .6 or len(beats) < 100:
    raise RuntimeError('Insufficient measured rhythmic evidence; do not publish a guessed grid.')
accents = [b for b,w in zip(beats,weights) if w >= float(np.percentile(weights,65))]
window = int(sr*8)
levels = [(i/sr,min(len(x),i+window)/sr,float(np.sqrt(np.mean(x[i:i+window]**2)))) for i in range(0,len(x),window)]
maximum = max(v[2] for v in levels)
sections = [{'start':round(a,3),'end':round(b,3),'energy':round(e/maximum,3),'kind':'measured-energy-window'} for a,b,e in levels]
waveform = [round(float(np.max(abs(chunk))),3) for chunk in np.array_split(x,360)]
def nearby_quiet_point(time):
    center = int(time*sr)
    lo, hi = max(0,center-48), min(len(x),center+49)
    return round((lo+int(np.argmin(abs(x[lo:hi]))))/sr,3)
# Start before the transient, not midway through it; quiet sample boundaries
# reduce clicks. Beat expansion always uses these exact playback loop points.
loop_start = nearby_quiet_point(max(0,beats[0]-.04))
loop_end = nearby_quiet_point(min((b for b in beats if b > 160),key=lambda b:abs(b-166.2))-.04)
analysis = dict(duration=round(duration,3),bpm=round(bpm,1),confidence=round(confidence,3),reliable=True,
                method='offline-spectral-flux-phase-fit',beats=beats,beatStrengths=weights,accentBeats=accents,
                sections=sections,waveform=waveform,loopStart=loop_start,loopEnd=loop_end,
                evidence=dict(autocorrelation=round(float(correlation[lag]),3),subdivisionCoherence=round(float(subdivision_coherence),3),meanAlignmentErrorMs=round(float(np.mean(residuals))*1000,1)),
                warnings=['BPM为主脉冲估计；半速/倍速也可成立。切点使用实际检测的起音，不将每个拍点都当作换镜指令。'])
data = dict(id='we-never-user-video-v1',title='We Never（Vibe知识大赏）',version='若如初见 · 用户视频提取版',
            file='./music/we-never-vibe.m4a',source='用户提供的视频音轨，已去除静音和抖音片尾；未改变播放速度',
            sha256=hashlib.sha256(Path('dist/music/we-never-vibe.m4a').read_bytes()).hexdigest(),analysis=analysis)
Path(sys.argv[2]).write_text('export const DEFAULT_MUSIC='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
print(json.dumps({k:analysis[k] for k in ['duration','bpm','confidence','loopStart','loopEnd','evidence']},ensure_ascii=False))
print('Actual detected beats:',len(beats),'Accents:',len(accents))
