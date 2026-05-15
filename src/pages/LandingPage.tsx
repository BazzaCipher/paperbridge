import { Link } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { SEO } from '../components/seo/SEO';
import { SoftwareAppJsonLd } from '../components/seo/JsonLd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogleDrive, faDropbox, faConfluence, faNotion, faTrello, faSlack } from '@fortawesome/free-brands-svg-icons';

/* ---- Scroll-reveal hook ------------------------------------------------- */

function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* ---- Mouse-tracking glow for feature cards ------------------------------ */

function useMouseGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, []);
  return { ref, onMove };
}

/* ---- Animated counter --------------------------------------------------- */

function AnimatedStat({ value, suffix, label, delay }: { value: number; suffix: string; label: string; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setStarted(true); obs.disconnect(); } },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    const timeout = setTimeout(() => {
      const duration = 1200;
      const steps = 40;
      const increment = value / steps;
      let current = 0;
      const interval = setInterval(() => {
        current += increment;
        if (current >= value) {
          setDisplay(value);
          clearInterval(interval);
        } else {
          setDisplay(Math.floor(current));
        }
      }, duration / steps);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timeout);
  }, [started, value, delay]);

  return (
    <div ref={ref} className="text-center">
      <div className="text-4xl md:text-5xl font-bold text-navy-900 tabular-nums">
        {display}{suffix}
      </div>
      <p className="mt-2 text-sm text-navy-500 leading-relaxed">{label}</p>
    </div>
  );
}

/* ---- Value proposition pillars ------------------------------------------ */

const pillars = [
  {
    title: 'Your team finishes faster',
    description: 'Every document uploaded once, every figure extracted automatically. Your team spends time on advice, not data entry.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    stat: '3x',
    statLabel: 'faster per return',
  },
  {
    title: 'Audit trail built in',
    description: 'Every number links back to the exact line on the original document. When the ATO asks, you show them in seconds.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    stat: '100%',
    statLabel: 'source-linked',
  },
  {
    title: 'No more manual keying',
    description: 'Stop re-typing rental statements into spreadsheets. Upload the document, select the fields, and the summary builds itself.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
    stat: '0',
    statLabel: 'hours re-keying',
  },
];

/* ---- Feature data ------------------------------------------------------- */

const features = [
  {
    num: '01',
    title: 'Any Client Document',
    description: 'Rental statements, loan summaries, payment summaries, receipts - drop them on the canvas and start extracting. PDF or image.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'Source-Linked Numbers',
    description: 'Every figure in your summary links back to the exact line on the original document. If the ATO asks, you can show them.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.813a4.5 4.5 0 00-6.364-6.364L4.5 8.25" />
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Automatic Totals',
    description: 'Income, deductions, expenses - totalled and cross-checked automatically. No formulas to maintain.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V13.5zm0 2.25h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V18zm2.498-6.75h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V13.5zm0 2.25h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V18zm2.504-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V18zm2.498-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zM8.25 6h7.5v2.25h-7.5V6zM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0012 2.25z" />
      </svg>
    ),
  },
  {
    num: '04',
    title: 'Client-Ready Output',
    description: 'Generate a clean summary you can attach to the return or send to your client for sign-off.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
      </svg>
    ),
  },
  {
    num: '05',
    title: 'Organised by Client',
    description: 'Multiple properties, multiple income sources - each gets its own workspace. Roll them up into a single summary at the end.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  },
  {
    num: '06',
    title: 'Full Audit Trail',
    description: 'Export the complete workpaper - every source document, every extracted value, every calculation - as a single portable file.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    ),
  },
];

const comparisons = [
  {
    before: 'Manually keying client documents into spreadsheets',
    after: 'Upload once, extract automatically',
  },
  {
    before: 'Chasing clients for missing documents at lodgement',
    after: 'See gaps before you start the return',
  },
  {
    before: 'Hoping the ATO doesn\'t ask how you got that number',
    after: 'Every figure traced to its source document',
  },
];

/* ---- Sections ----------------------------------------------------------- */

function StatsBar() {
  const { ref, visible } = useReveal(0.2);
  return (
    <section ref={ref} className="py-16 md:py-20 border-y border-navy-100 bg-white">
      <div className="max-w-4xl mx-auto px-6">
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8 reveal ${visible ? 'visible' : ''}`}>
          <AnimatedStat value={80} suffix="%" label="Less time on data entry per return" delay={0} />
          <AnimatedStat value={100} suffix="%" label="Of figures source-linked for audit" delay={150} />
          <AnimatedStat value={0} suffix=" spreadsheets" label="To maintain or reconcile" delay={300} />
        </div>
      </div>
    </section>
  );
}

function PillarsSection() {
  const { ref, visible } = useReveal(0.1);
  return (
    <section ref={ref} className="py-24 md:py-32 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className={`text-center mb-16 reveal ${visible ? 'visible' : ''}`}>
          <p className="text-xs font-semibold text-green-500 uppercase tracking-[0.15em] mb-3">Why practice managers switch</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-navy-900">
            Run a tighter practice, not a harder one
          </h2>
          <p className="mt-4 text-base text-navy-500 max-w-2xl mx-auto leading-relaxed">
            Your team handles more clients with fewer errors. You get visibility and confidence at every step.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {pillars.map((p, i) => (
            <div
              key={p.title}
              className={`card-hover relative rounded-lg border border-navy-100 bg-white p-8 reveal ${visible ? 'visible' : ''}`}
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-green-500/8 text-green-600">
                  {p.icon}
                </div>
                <span className="text-2xl font-bold text-navy-900">{p.stat}</span>
              </div>
              <h3 className="text-lg font-semibold text-navy-900 mb-2">{p.title}</h3>
              <p className="text-sm text-navy-500 leading-relaxed">{p.description}</p>
              <p className="mt-3 text-xs font-medium text-green-600">{p.statLabel}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ComparisonSection({ comparisons }: { comparisons: { before: string; after: string }[] }) {
  const { ref, visible } = useReveal(0.2);
  return (
    <section ref={ref} className="py-16 md:py-20 bg-navy-50/40">
      <div className="max-w-3xl mx-auto px-6">
        <p className={`text-xs font-semibold text-navy-500 uppercase tracking-[0.15em] mb-3 text-center reveal ${visible ? 'visible' : ''}`}>Before & after Paperbridge</p>
        <h2 className={`text-2xl md:text-3xl font-bold text-navy-900 tracking-tight text-center mb-10 reveal ${visible ? 'visible' : ''}`}>
          What changes for your practice
        </h2>
        <div className="space-y-2">
          {comparisons.map((c, i) => (
            <div
              key={c.before}
              className={`card-hover flex items-center gap-4 md:gap-6 rounded border border-navy-100 bg-white px-5 py-3.5 reveal-left ${visible ? 'visible' : ''}`}
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <div className="flex-1 text-right">
                <span className="text-sm text-navy-400 line-through decoration-navy-300/60">{c.before}</span>
              </div>
              <div className="shrink-0 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-500 transition-transform duration-300" style={{ transform: visible ? 'translateX(0) scale(1)' : 'translateX(-4px) scale(0.8)', transitionDelay: `${200 + i * 80}ms` }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
              <div className="flex-1">
                <span className="text-sm font-medium text-navy-800">{c.after}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection({ features }: { features: { num: string; title: string; description: string; icon: React.ReactNode }[] }) {
  const { ref, visible } = useReveal(0.1);
  const glow = useMouseGlow();
  return (
    <section ref={ref} className="relative py-24 md:py-32 bg-navy-900">
      <div className="relative max-w-6xl mx-auto px-6">
        <div className={`max-w-2xl mb-16 reveal ${visible ? 'visible' : ''}`}>
          <p className="text-xs font-semibold text-green-400 uppercase tracking-[0.15em] mb-3">Built for the workflow</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Individual returns, without the grunt work
          </h2>
          <p className="mt-4 text-base text-navy-300 leading-relaxed">
            Purpose-built for Australian tax practices handling individual returns.
            Every number sourced, every summary audit-ready.
          </p>
        </div>

        <div ref={glow.ref} onMouseMove={glow.onMove} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.06] rounded-lg overflow-hidden">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`feature-card group relative p-6 bg-navy-900 hover:bg-navy-800/80 reveal-scale ${visible ? 'visible' : ''}`}
              style={{ transitionDelay: `${i * 50}ms` }}
            >
              <span className="absolute top-4 right-5 text-[2.5rem] font-bold leading-none text-white/[0.04] select-none pointer-events-none">{f.num}</span>
              <div className="text-green-400 mb-3 transition-transform duration-300 group-hover:scale-110">{f.icon}</div>
              <h3 className="text-sm font-semibold text-white mb-1.5">{f.title}</h3>
              <p className="text-sm text-navy-300 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const { ref, visible } = useReveal(0.15);
  const steps = [
    {
      num: '01',
      title: 'Upload the documents',
      description: 'Drop your client\'s statements, receipts, and summaries onto the canvas. PDF or image, it just works.',
    },
    {
      num: '02',
      title: 'Extract the numbers',
      description: 'Select the figures you need - income, deductions, expenses. Each value stays linked to the original document.',
    },
    {
      num: '03',
      title: 'Export the summary',
      description: 'Get an audit-ready summary for the tax return. Every number traceable, every document attached.',
    },
  ];

  return (
    <section ref={ref} className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <div className={`text-center mb-16 reveal ${visible ? 'visible' : ''}`}>
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-[0.15em] mb-3">How it works</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-navy-900">
            Documents in, rental schedule out
          </h2>
        </div>

        <div className="relative max-w-3xl mx-auto">
          <div className="hidden md:block absolute top-[22px] left-[calc(16.67%+20px)] right-[calc(16.67%+20px)] z-0">
            <div className="h-px border-t border-navy-200 origin-left transition-transform duration-700" style={{ transform: visible ? 'scaleX(1)' : 'scaleX(0)', transitionDelay: '300ms' }} />
          </div>
          <div className="md:hidden absolute left-[19px] top-12 bottom-12 z-0">
            <div className="w-px h-full border-l border-navy-200 origin-top transition-transform duration-700" style={{ transform: visible ? 'scaleY(1)' : 'scaleY(0)', transitionDelay: '300ms' }} />
          </div>

          <div className="relative z-10 grid md:grid-cols-3 gap-10 md:gap-12">
            {steps.map((s, i) => (
              <div
                key={s.num}
                className={`flex md:flex-col items-start md:items-center md:text-center gap-5 md:gap-0 reveal ${visible ? 'visible' : ''}`}
                style={{ transitionDelay: `${150 + i * 120}ms` }}
              >
                <div className="shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-navy-900 text-white text-xs font-bold tracking-wider transition-transform duration-500" style={{ transform: visible ? 'scale(1)' : 'scale(0.6)', transitionDelay: `${200 + i * 120}ms` }}>
                  {s.num}
                </div>
                <div className="md:mt-5">
                  <h3 className="text-base font-semibold text-navy-900 mb-1">{s.title}</h3>
                  <p className="text-sm text-navy-500 leading-relaxed">{s.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- Integration logos (bubble map) ------------------------------------- */

const bubbles = [
  { name: 'Google Drive', color: '#1FA463', bg: 'rgba(31,164,99,0.08)',  size: 130, x: 50, y: 46, float: 4.5, icon: faGoogleDrive, iconPx: 48 },
  { name: 'Dropbox',      color: '#0061FF', bg: 'rgba(0,97,255,0.08)',   size: 96,  x: 20, y: 28, float: 5.5, icon: faDropbox,     iconPx: 36 },
  { name: 'Notion',       color: '#191919', bg: 'rgba(25,25,25,0.05)',   size: 92,  x: 80, y: 26, float: 6,   icon: faNotion,      iconPx: 34 },
  { name: 'Confluence',   color: '#1868DB', bg: 'rgba(24,104,219,0.08)', size: 82,  x: 16, y: 72, float: 5,   icon: faConfluence,  iconPx: 30 },
  { name: 'Trello',       color: '#0079BF', bg: 'rgba(0,121,191,0.08)',  size: 78,  x: 84, y: 70, float: 5.8, icon: faTrello,      iconPx: 28 },
  { name: 'Slack',        color: '#611F69', bg: 'rgba(97,31,105,0.07)',  size: 74,  x: 50, y: 88, float: 6.5, icon: faSlack,       iconPx: 26 },
];

function IntegrationsSection() {
  const { ref, visible } = useReveal(0.15);
  return (
    <section ref={ref} className="py-16 md:py-20 bg-navy-50/40">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <p className={`text-xs font-semibold text-navy-500 uppercase tracking-[0.15em] mb-3 reveal ${visible ? 'visible' : ''}`}>
          Works with your stack
        </p>
        <h2 className={`text-2xl md:text-3xl font-bold text-navy-900 tracking-tight reveal ${visible ? 'visible' : ''}`}>
          Export anywhere you already work
        </h2>
        <p className={`mt-3 text-base text-navy-500 max-w-lg mx-auto leading-relaxed reveal ${visible ? 'visible' : ''}`}>
          Save your finished workpapers to Google Drive, Dropbox, or wherever your practice stores client files.
        </p>

        <div className="relative mt-12 mx-auto w-full max-w-lg" style={{ aspectRatio: '1 / 0.8' }}>
          {bubbles.map((b, i) => (
            <div
              key={b.name}
              className="absolute"
              style={{
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: b.size,
                height: b.size,
                transform: visible
                  ? 'translate(-50%, -50%) scale(1)'
                  : 'translate(-50%, -50%) scale(0)',
                opacity: visible ? 1 : 0,
                transition: `transform 0.5s var(--ease-spring) ${150 + i * 100}ms, opacity 0.4s ease ${150 + i * 100}ms`,
              }}
            >
              <div
                className="group flex items-center justify-center rounded-full cursor-default w-full h-full"
                title={b.name}
                style={{
                  backgroundColor: b.bg,
                  border: `1.5px solid ${b.color}18`,
                  animation: visible ? `bubble-float ${b.float}s ease-in-out ${0.8 + i * 0.15}s infinite` : 'none',
                  boxShadow: `0 2px 8px ${b.color}10`,
                  transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.boxShadow = `0 8px 24px ${b.color}20`;
                  el.style.borderColor = `${b.color}40`;
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.boxShadow = `0 2px 8px ${b.color}10`;
                  el.style.borderColor = `${b.color}18`;
                }}
              >
                <FontAwesomeIcon
                  icon={b.icon}
                  color={b.color}
                  className="transition-transform duration-200 group-hover:scale-110"
                  style={{ fontSize: b.iconPx }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  const { ref, visible } = useReveal(0.2);
  return (
    <section ref={ref} className="py-24 md:py-28 bg-navy-900">
      <div className={`max-w-2xl mx-auto px-6 text-center reveal-scale ${visible ? 'visible' : ''}`}>
        <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
          Give your team the tool that pays for itself
        </h2>
        <p className="mt-4 text-base text-navy-300 max-w-lg mx-auto leading-relaxed">
          Process individual clients faster, with complete audit trails and zero manual data entry. Your team will thank you.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/canvas"
            className="focus-ring btn-press group inline-flex items-center px-6 py-3 text-sm font-semibold bg-green-500 text-white rounded-md hover:bg-green-600 cursor-pointer"
          >
            Try it free
            <svg className="ml-2 w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
          <Link
            to="/blog"
            className="focus-ring btn-press px-6 py-3 text-sm font-semibold text-white/70 border border-white/10 rounded-md hover:text-white hover:border-white/20 cursor-pointer"
          >
            Read the blog
          </Link>
        </div>
        <p className="mt-8 text-sm text-navy-300">
          Want to roll this out across your practice?{' '}
          <a
            href="mailto:barryzmeng@gmail.com?subject=Integrating%20Paperbridge%20into%20our%20practice"
            className="font-semibold text-green-400 hover:text-green-300 underline-offset-4 hover:underline"
          >
            Contact me to discuss how to integrate this tool into your business
          </a>
          .
        </p>
      </div>
    </section>
  );
}

/* ---- Page --------------------------------------------------------------- */

export function LandingPage() {
  return (
    <>
      <SEO />
      <SoftwareAppJsonLd />

      {/* Hero - targets the boss with outcome-driven messaging */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-20">
          <div className="hero-stagger max-w-3xl mx-auto text-center">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/8 border border-green-500/15">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-xs font-medium text-green-700 tracking-wide">
                  For Australian tax practices
                </span>
              </span>
            </div>

            <h1 className="mt-8 text-4xl md:text-5xl lg:text-[3.5rem] font-bold tracking-tight text-navy-900 leading-[1.08]">
              Your team processes returns{' '}
              <br className="hidden sm:block" />
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-green-500 to-green-600 bg-clip-text text-transparent">
                  3x faster
                </span>
                <svg className="absolute -bottom-1.5 left-0 w-full h-[3px]" viewBox="0 0 200 4" preserveAspectRatio="none">
                  <line x1="0" y1="2" x2="200" y2="2" stroke="url(#cg)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="200" strokeDashoffset="200" className="underline-draw" />
                  <defs>
                    <linearGradient id="cg" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#059669" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#047857" stopOpacity="0.4" />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
              {' '}with full audit trails
            </h1>

            <p className="mt-6 text-lg md:text-xl text-navy-500 leading-relaxed max-w-2xl mx-auto">
              Stop losing hours to manual data entry. Paperbridge extracts, links, and summarises your clients' documents automatically - so your team focuses on advice, not admin.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/canvas"
                className="focus-ring btn-press group inline-flex items-center px-7 py-3.5 text-sm font-semibold bg-navy-900 text-white rounded-md hover:bg-navy-800 cursor-pointer"
              >
                Try it free
                <svg className="ml-2 w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link
                to="/blog"
                className="focus-ring btn-press inline-flex items-center px-7 py-3.5 text-sm font-semibold text-navy-600 rounded-md border border-navy-200 hover:border-navy-300 hover:bg-navy-50 cursor-pointer"
              >
                See how it works
              </Link>
            </div>

            {/* Trust signals - efficiency focused */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-navy-400">
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Minutes, not hours
              </span>
              <span className="text-navy-200">&middot;</span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                Complete audit trail
              </span>
              <span className="text-navy-200">&middot;</span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
                Built for teams
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar - Breezeway-style quantified outcomes */}
      <StatsBar />

      {/* Three pillars - boss-targeted value props */}
      <PillarsSection />

      {/* Before & after */}
      <ComparisonSection comparisons={comparisons} />

      {/* Detailed features */}
      <FeaturesSection features={features} />

      {/* How it works */}
      <HowItWorksSection />

      {/* Integrations */}
      <IntegrationsSection />

      {/* CTA */}
      <CtaSection />
    </>
  );
}
