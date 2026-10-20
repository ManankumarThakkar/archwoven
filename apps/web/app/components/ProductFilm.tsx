'use client';

import { useEffect, useRef, useState } from 'react';

const movie = '/media/archwoven-overview-v1.mp4';
const poster = '/media/archwoven-overview-v1.jpg';

export function ProductFilm() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const automaticPauses = useRef(0);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(true);
  const [wanted, setWanted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    setWanted(!preference.matches && !connection?.saveData);
    setVisible(!document.hidden);
    setReady(true);
    const video = videoRef.current!;
    const iosVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    setFullscreen(Boolean(playerRef.current?.requestFullscreen || iosVideo.webkitEnterFullscreen));
    const visibility = () => setVisible(!document.hidden);
    const fullscreenChange = () => setExpanded(document.fullscreenElement === playerRef.current);
    document.addEventListener('fullscreenchange', fullscreenChange);
    const motion = () => { if (preference.matches) setWanted(false); };
    document.addEventListener('visibilitychange', visibility);
    preference.addEventListener('change', motion);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(
      entries => setInView(entries[0]?.isIntersecting ?? false), { threshold: 0.1 },
    );
    if (observer) observer.observe(video); else setInView(true);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('fullscreenchange', fullscreenChange);
      preference.removeEventListener('change', motion);
    };
  }, []);

  useEffect(() => {
    if (wanted && inView && visible && !failed) setLoaded(true);
  }, [wanted, inView, visible, failed]);

  useEffect(() => {
    const video = videoRef.current!;
    let cancelled = false;
    const stop = () => {
      // Native fullscreen also has a Pause control; only our visibility pauses may auto-resume.
      if (!video.paused) { automaticPauses.current++; video.pause(); }
    };
    if (loaded && wanted && inView && visible && !failed) {
      video.play().catch(() => {
        if (!cancelled && !video.error) { setWanted(false); setNotice('Select Play to start the film.'); }
      });
    } else stop();
    return () => { cancelled = true; stop(); };
  }, [loaded, wanted, inView, visible, failed]);

  function play() {
    setNotice('');
    setWanted(true);
    // A direct call preserves the user gesture on browsers that restrict media playback.
    if (!loaded) { videoRef.current!.src = movie; setLoaded(true); }
    videoRef.current!.play().catch((error: unknown) => {
      if (videoRef.current?.error || (error instanceof DOMException && error.name === 'AbortError')) return;
      setWanted(false); setNotice('Playback could not start. You can read the summary below.');
    });
  }
  function pause() { setWanted(false); videoRef.current!.pause(); }
  function restart() { videoRef.current!.currentTime = 0; play(); }
  async function expand() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (playerRef.current?.requestFullscreen) await playerRef.current.requestFullscreen();
      else (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
    } catch { setNotice('Fullscreen is unavailable in this browser. The film still plays here.'); }
  }

  return <section className="lp-film" id="example" aria-labelledby="film-title">
    <div className="lp-film-heading"><div><p className="lp-eyebrow">FOLLOW THE CONNECTIONS</p><h2 id="film-title">A system in motion.</h2></div><p>From an idea to a request.<br />{' '}From your code to the evidence.</p></div>
    <div className="lp-film-player" ref={playerRef}>
      <video ref={videoRef} id="product-film" width="1920" height="1080" muted loop playsInline preload="none"
        poster={poster} src={loaded ? movie : undefined}
        aria-label="Archwoven product film, 32 seconds, no audio" aria-describedby="film-description"
        onPlay={() => { setPlaying(true); setWanted(true); }}
        onPause={() => {
          setPlaying(false);
          if (automaticPauses.current > 0) automaticPauses.current--;
          else setWanted(false);
        }}
        onError={() => { setFailed(true); setWanted(false); setNotice('The film is unavailable. You can read the summary below and open the workspace.'); }} />
      <div className="lp-film-controls" role="group" aria-label="Film controls">
        <div><button type="button" className="lp-film-toggle" aria-controls="product-film" disabled={!ready || failed} onClick={playing ? pause : play}><span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>{playing ? 'Pause' : 'Play'}</button><button type="button" aria-controls="product-film" disabled={!ready || failed} onClick={restart}>Restart</button></div>
        <span className="lp-film-duration">32 seconds <span aria-hidden="true">·</span> No audio</span>
        {fullscreen && <button type="button" className="lp-film-expand" onClick={expand} aria-label={expanded ? 'Exit fullscreen' : 'View film fullscreen'}><span aria-hidden="true">⛶</span><span>{expanded ? 'Exit fullscreen' : 'Fullscreen'}</span></button>}
      </div>
    </div>
    <p className="lp-film-notice" role="status">{notice}</p>
    <div className="lp-film-caption"><p id="film-description">Explore a streaming platform, follow its requests and events, then inspect the source behind a repository diagram.</p><details><summary>Read the film summary</summary><ol>
      <li>A description becomes a streaming platform with 14 components and 14 connections. Viewers use web and TV apps through a CDN and API gateway. An account service is marked as proposed.</li>
      <li>A request moves from Viewer through Web App, CDN and API Gateway to Playback. Asynchronous view events continue through Kafka and Analytics to ClickHouse.</li>
      <li>A separate, recorded analysis of the public FastAPI template shows its application, API router, five route modules and PostgreSQL.</li>
      <li>The application-to-router connection reveals backend/app/main.py, line 35, pinned to commit b1125d8. Environment overrides remain unverified.</li>
      <li>A connecting thread resolves into the Archwoven wordmark: Architecture, connected.</li>
    </ol><p>Recorded examples arranged as a motion illustration. Explore and edit your own diagrams in the workspace.</p></details></div>
    <noscript><p className="lp-film-noscript">The film needs JavaScript to play. Read the summary above, or <a href="/workspace">open the workspace</a>.</p></noscript>
  </section>;
}
