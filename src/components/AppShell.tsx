import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  HOME_NODE_ID,
  NAV_ROOT,
  hashFor,
  isLeaf,
  nodeFromHash,
  parentOf,
  pathTo,
  type NavNode,
  type ScreenId,
} from '../domain/navigation';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { AccountPanel } from './AccountPanel';
import { AppMark } from './AppMark';
import { AutoSessionPanel } from './AutoSessionPanel';
import { ChordHeroPanel } from './ChordHeroPanel';
import { CompanionCard } from './CompanionCard';
import { PracticePanel } from './PracticePanel';
import { ShapeTrainerPanel } from './ShapeTrainerPanel';
import { StringSniperPanel } from './StringSniperPanel';
import { TunerPanel } from './TunerPanel';

/**
 * The app shell: one screen at a time, and the way between them.
 *
 * Replaces the old dashboard, which rendered all six panels stacked on one
 * scrolling page. That was fine as a way to see everything working and hopeless
 * as something to use — every drill was permanently half on screen, and the
 * microphone panels sat next to each other competing for it.
 *
 * The rules here are small:
 *
 * - **One screen at a time.** A leaf renders its panel and nothing else.
 * - **The tree is the menu.** Branches render their children; there is no
 *   separate navigation list to keep in step with the tree.
 * - **The hash is the location.** Back, reload and the installed PWA reopening
 *   all land where you were, and nothing needs a router to do it.
 */

interface AppShellProps {
  user: User;
}

export function AppShell({ user }: AppShellProps) {
  const online = useOnlineStatus();
  const [nodeId, setNodeId] = useState<string>(() => nodeFromHash(window.location.hash).id);

  // Hand-offs between screens: Today's Session can send a shape to the trainer
  // or a progression to Chord Hero. The request is held here, in the one place
  // that can also do the navigating.
  const [trainerSkillId, setTrainerSkillId] = useState<string | null>(null);
  const [heroProgressionId, setHeroProgressionId] = useState<string | null>(null);

  const go = useCallback((id: string) => {
    setNodeId(id);
    // pushState rather than assigning location.hash, so the browser back button
    // walks the history we actually created.
    window.history.pushState(null, '', hashFor(id));
  }, []);

  // The browser's own back button, and anyone editing the hash by hand.
  useEffect(() => {
    const onPop = () => setNodeId(nodeFromHash(window.location.hash).id);
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  const node = nodeFromHash(hashFor(nodeId));
  // Drop the root, the parent (the back link already names it) and the node
  // itself (the "here" crumb does). What is left is the middle of a deep tree —
  // empty today, and correct when the tree grows.
  const trail = pathTo(node.id)?.slice(1, -2) ?? [];
  // No back link out of a section: the tab bar already holds every section, and
  // a breadcrumb whose only destination is "the list of things in the tab bar"
  // is a rung on a ladder to nowhere.
  const up = parentOf(node.id);
  const parent = up && up.id !== 'root' ? up : null;

  const openInTrainer = useCallback(
    (skillId: string) => {
      setTrainerSkillId(skillId);
      go('train.shapes');
    },
    [go],
  );

  const openInChordHero = useCallback(
    (progressionId: string) => {
      setHeroProgressionId(progressionId);
      go('train.chord-hero');
    },
    [go],
  );

  function renderScreen(screen: ScreenId) {
    switch (screen) {
      case 'today':
        return (
          <PracticePanel
            user={user}
            onOpenInTrainer={openInTrainer}
            onOpenInChordHero={openInChordHero}
          />
        );
      case 'chord-hero':
        return (
          <ChordHeroPanel
            user={user}
            requestedProgressionId={heroProgressionId}
            onRequestHandled={() => setHeroProgressionId(null)}
          />
        );
      case 'shapes':
        return (
          <ShapeTrainerPanel
            user={user}
            requestedSkillId={trainerSkillId}
            onRequestHandled={() => setTrainerSkillId(null)}
          />
        );
      case 'sniper':
        return <StringSniperPanel />;
      case 'tuner':
        return <TunerPanel />;
      case 'companion':
        return <CompanionCard user={user} />;
      case 'account':
        return <AccountPanel user={user} />;
      case 'auto':
        return <AutoSessionPanel user={user} />;
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button
          type="button"
          className="topbar__home"
          onClick={() => go(HOME_NODE_ID)}
          aria-label="Home"
        >
          <AppMark size={28} />
        </button>
        <p className="topbar__where">{node.title}</p>
        {online ? null : (
          <span className="topbar__offline" title="Offline — everything still works">
            offline
          </span>
        )}
      </header>

      <nav
        className={`crumbs${parent ? '' : ' crumbs--hidden'}`}
        aria-label="Breadcrumb"
      >
        {parent ? (
          <button type="button" className="crumbs__back" onClick={() => go(parent.id)}>
            ← {parent.title}
          </button>
        ) : null}

        {trail.map((crumb) => (
          <button key={crumb.id} type="button" className="crumbs__crumb" onClick={() => go(crumb.id)}>
            {crumb.title}
          </button>
        ))}
        <span className="crumbs__here" data-testid="crumb-here">
          {node.title}
        </span>
      </nav>

      <main className="content" data-node={node.id}>
        {isLeaf(node) ? (
          renderScreen(node.screen!)
        ) : (
          <>
            <header className="section-head">
              <p className="section-head__eyebrow">Seven minutes before dinner</p>
              <h1 className="section-head__title">{node.title}</h1>
            </header>
            {node.blurb ? <p className="menu__lead">{node.blurb}</p> : null}
            <ul className="menu" data-testid="menu">
              {(node.children ?? []).map((child: NavNode) => (
                <li key={child.id}>
                  <button
                    type="button"
                    className="menu__item"
                    onClick={() => go(child.id)}
                    data-nav={child.id}
                  >
                    <span className="menu__title">
                      {child.title}
                      {child.needsMicrophone ? (
                        <span className="menu__mic" title="Uses the microphone">
                          mic
                        </span>
                      ) : null}
                    </span>
                    {child.blurb ? <span className="menu__blurb">{child.blurb}</span> : null}
                    <span className="menu__chevron" aria-hidden="true">
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {/* The root sections, always one tap away from anywhere. */}
      <nav className="tabbar" aria-label="Sections">
        {SECTIONS.map((section) => {
          const active = node.id === section.id || node.id.startsWith(`${section.id}.`);
          return (
            <button
              key={section.id}
              type="button"
              className={`tabbar__tab${active ? ' tabbar__tab--active' : ''}`}
              onClick={() => go(section.id)}
              aria-current={active ? 'page' : undefined}
              data-tab={section.id}
            >
              <TabIcon section={section.id} />
              {section.title}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Tab icons, drawn rather than shipped.
 *
 * Four glyphs from the design mockups: a target for Practise, a fret window for
 * Train, bars for Progress, a dial for Tools. Inline SVG so they render from the
 * service worker cache like everything else, and so they take `currentColor`
 * from the active state instead of needing two files each.
 */
function TabIcon({ section }: { section: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    'aria-hidden': true,
    className: 'tabbar__icon',
  } as const;

  switch (section) {
    case 'practise':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'train':
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="15" height="15" rx="4" />
        </svg>
      );
    case 'progress':
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M6 15v4M12 10v9M18 6v13" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
  }
}

/**
 * The root sections, in tab-bar order.
 *
 * Derived from the tree rather than listed again: a tab bar that can disagree
 * with the menu it navigates is a tab bar that eventually does.
 */
const SECTIONS = NAV_ROOT.children ?? [];
