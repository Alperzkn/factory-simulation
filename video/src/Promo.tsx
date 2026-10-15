import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { loadFont as loadBarlow } from '@remotion/google-fonts/Barlow';
import { loadFont as loadCondensed } from '@remotion/google-fonts/BarlowCondensed';

const { fontFamily: body } = loadBarlow('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });
const { fontFamily: display } = loadCondensed('normal', { weights: ['600'], subsets: ['latin'] });

export const FPS = 30;
const X = 10; // cross-fade length in frames
const C = { bg: '#E6EAED', ink: '#16232D', ink2: '#4C5C68', blue: '#1D5F9A', line: '#D6DCE1', green: '#2B9A5A' };
const APP_URL = 'factory-simulation-eosin.vercel.app';
const REPO_URL = 'github.com/Alperzkn/factory-simulation';

// footage cuts: first captured frame (see record.mjs and marks.json), length in frames, caption
const LAST_FRAME = 1594;
const CLIPS: { from: number; len: number; text: string }[] = [
  { from: 20, len: 150, text: 'Seven stations, two AGVs, operators and a warehouse, simulated live' },
  { from: 215, len: 100, text: 'Every cycle, part and fault is modelled' },
  { from: 330, len: 180, text: 'Click any machine for OEE, counters and live process signals' },
  { from: 545, len: 180, text: 'A forklift serves the racks, the line and both docks' },
  { from: 770, len: 115, text: 'Stock is reordered automatically and trucks arrive at the dock' },
  { from: 925, len: 115, text: 'Dashboards for OEE, production, quality, energy and maintenance' },
  { from: 1078, len: 95, text: 'Energy use per station and per finished disc' },
  { from: 1200, len: 180, text: 'Trigger a fault and a technician walks over to repair it' },
  { from: 1410, len: 180, text: 'Run the shift at up to 120 times real time' },
];
const f = (s: number) => Math.round(s * FPS);
const INTRO = f(3.4), DATA = f(4.6), OUTRO = f(5.2);
export const TOTAL = INTRO + DATA + OUTRO + CLIPS.reduce((n, c) => n + c.len, 0) - X * (CLIPS.length + 2);

const ease = Easing.bezier(0.2, 0.7, 0.2, 1);
const rise = (frame: number, delay = 0, dist = 26) => {
  const p = interpolate(frame, [delay, delay + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
};

const Disc: React.FC<{ size: number }> = ({ size }) => {
  const frame = useCurrentFrame();
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" style={{ transform: `rotate(${frame * 1.2}deg)` }}>
      <circle cx="17" cy="17" r="15.5" fill="none" stroke={C.ink} strokeWidth="3" />
      <circle cx="17" cy="17" r="6.5" fill={C.blue} />
      <g fill={C.ink}><circle cx="17" cy="6.6" r="1.3" /><circle cx="27.4" cy="17" r="1.3" /><circle cx="17" cy="27.4" r="1.3" /><circle cx="6.6" cy="17" r="1.3" /></g>
    </svg>
  );
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', padding: '0 170px', fontFamily: body, color: C.ink }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, ...rise(frame, 2) }}>
        <Disc size={64} />
        <div style={{ fontSize: 34, fontWeight: 500, color: C.ink2 }}>Kestrel Brake Works, a simulated plant</div>
      </div>
      <div style={{ fontFamily: display, fontWeight: 600, fontSize: 148, lineHeight: 1.0, marginTop: 34, letterSpacing: '-0.01em', ...rise(frame, 8) }}>
        A factory digital twin<br />that runs in your browser
      </div>
      <div style={{ fontSize: 38, color: C.ink2, marginTop: 40, maxWidth: 1300, lineHeight: 1.35, ...rise(frame, 18) }}>
        A brake disc machining line and its warehouse, in 3D, producing the data a real plant would.
      </div>
    </AbsoluteFill>
  );
};

const Clip: React.FC<{ from: number; len: number; text: string }> = ({ from, text }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Img src={staticFile(`frames/${String(Math.min(LAST_FRAME, from + frame)).padStart(5, '0')}.jpg`)} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 118, display: 'flex', justifyContent: 'center' }}>
        <div style={{ fontFamily: display, fontWeight: 600, fontSize: 50, lineHeight: 1.1, color: '#fff', background: 'rgba(22,35,45,.94)', padding: '18px 34px 20px', borderRadius: 14, boxShadow: '0 14px 44px rgba(22,35,45,.3)', ...rise(frame, X + 2, 18) }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Data: React.FC = () => {
  const frame = useCurrentFrame();
  const rows: [string, string][] = [
    ['REST API', 'GET /api/v1/machines/M1'],
    ['MQTT', 'kestrel/line2/machines/M1/telemetry'],
    ['OPC UA', 'ns=1;s=Line2.Machines.M1.State'],
  ];
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', padding: '0 170px', fontFamily: body, color: C.ink }}>
      <div style={{ fontFamily: display, fontWeight: 600, fontSize: 104, lineHeight: 1.02, ...rise(frame, X) }}>Every figure is served as data</div>
      <div style={{ fontSize: 36, color: C.ink2, marginTop: 20, ...rise(frame, X + 6) }}>Run it with Node and connect your own tools. The interfaces are documented.</div>
      <div style={{ marginTop: 54, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {rows.map(([name, example], i) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `2px solid ${C.line}`, borderRadius: 14, padding: '22px 30px', ...rise(frame, X + 14 + i * 7) }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: C.green, marginRight: 22 }} />
            <div style={{ fontFamily: display, fontWeight: 600, fontSize: 48, width: 300 }}>{name}</div>
            <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 32, color: C.ink2 }}>{example}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const link = (label: string, url: string, delay: number) => (
    <div style={{ marginTop: 34, ...rise(frame, delay) }}>
      <div style={{ fontSize: 32, color: '#9FB3C4' }}>{label}</div>
      <div style={{ fontFamily: display, fontWeight: 600, fontSize: 70, marginTop: 4 }}>{url}</div>
    </div>
  );
  return (
    <AbsoluteFill style={{ background: C.ink, justifyContent: 'center', padding: '0 170px', fontFamily: body, color: '#fff' }}>
      <div style={{ fontFamily: display, fontWeight: 600, fontSize: 120, lineHeight: 1, ...rise(frame, X) }}>Open it and run a shift</div>
      {link('Live app', APP_URL, X + 10)}
      {link('Source code', REPO_URL, X + 18)}
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  const cut = <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: X })} />;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={INTRO}><Intro /></TransitionSeries.Sequence>
        {CLIPS.map((c, i) => (
          <React.Fragment key={i}>
            {cut}
            <TransitionSeries.Sequence durationInFrames={c.len}><Clip {...c} /></TransitionSeries.Sequence>
          </React.Fragment>
        ))}
        {cut}
        <TransitionSeries.Sequence durationInFrames={DATA}><Data /></TransitionSeries.Sequence>
        {cut}
        <TransitionSeries.Sequence durationInFrames={OUTRO}><Outro /></TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
