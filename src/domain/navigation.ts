/**
 * The app's navigation tree.
 *
 * Pure data plus the walking logic — no React, no router dependency. A router
 * would be a reasonable choice for an app with URLs worth sharing; this one is
 * an installed PWA with a dozen screens, where a 40 kB dependency buys a
 * `<Link>` component and takes away the ability to say exactly what the tree is
 * in one file.
 *
 * The tree is the menu *and* the map: the shell renders a branch's children as
 * a menu, a leaf as its panel, and the path back out as breadcrumbs. Adding a
 * screen means adding a node here and a case in the shell's renderer, which is
 * the smallest number of places it can be.
 */

/** Every leaf screen. The shell maps these to components. */
export type ScreenId =
  | 'auto'
  | 'today'
  | 'chord-hero'
  | 'shapes'
  | 'sniper'
  | 'tuner'
  | 'companion'
  | 'account';

export interface NavNode {
  id: string;
  title: string;
  /** One line under the title in a menu. */
  blurb?: string;
  /** Leaves have a screen; branches have children. */
  screen?: ScreenId;
  children?: readonly NavNode[];
  /**
   * Whether the microphone is involved. The shell uses this to warn once, up
   * front, rather than each panel discovering it separately.
   */
  needsMicrophone?: boolean;
}

/**
 * The tree.
 *
 * Deliberately shallow — two levels below the root. A practice app that makes
 * you navigate is a practice app you stop opening, so the thing you do every
 * day sits at the root and everything else is at most two taps away.
 */
export const NAV_ROOT: NavNode = {
  id: 'root',
  title: 'Guitar Practice Companion',
  children: [
    {
      id: 'practise',
      title: 'Practise',
      blurb: 'Let the app decide, or work the schedule yourself.',
      children: [
        {
          id: 'practise.auto',
          title: 'Auto session',
          blurb: 'Press play. It picks, coaches and moves you on.',
          screen: 'auto',
          needsMicrophone: true,
        },
        {
          id: 'practise.today',
          title: "Today's Session",
          blurb: 'The scheduled rotation, graded by you.',
          screen: 'today',
        },
      ],
    },
    {
      id: 'train',
      title: 'Train',
      blurb: 'Pick one thing and drill it.',
      children: [
        {
          id: 'train.chord-hero',
          title: 'Chord Hero',
          blurb: 'Progressions and riffs, scored by ear.',
          screen: 'chord-hero',
          needsMicrophone: true,
        },
        {
          id: 'train.shapes',
          title: 'Fretting Trainer',
          blurb: 'Chord shapes on a timer, with diagrams.',
          screen: 'shapes',
        },
        {
          id: 'train.sniper',
          title: 'String Sniper',
          blurb: 'Picking-hand accuracy, one string at a time.',
          screen: 'sniper',
          needsMicrophone: true,
        },
      ],
    },
    {
      id: 'progress',
      title: 'Progress',
      blurb: 'Streaks, milestones and what you have played.',
      children: [
        {
          id: 'progress.companion',
          title: 'Your companion',
          blurb: 'Streak, milestones and how it thinks you are doing.',
          screen: 'companion',
        },
      ],
    },
    {
      id: 'tools',
      title: 'Tools',
      blurb: 'Tuner, and the boring necessities.',
      children: [
        {
          id: 'tools.tuner',
          title: 'Tuner',
          blurb: 'Standard, drop D and half step down.',
          screen: 'tuner',
          needsMicrophone: true,
        },
        {
          id: 'tools.account',
          title: 'Account & sync',
          blurb: 'Where your practice is stored, and whether it has landed.',
          screen: 'account',
        },
      ],
    },
  ],
};

/**
 * The node the app opens on: coaching immediately, nothing to configure.
 *
 * The whole point of the auto session is that opening the app *is* starting to
 * practise. Anything else here — a home screen, a menu — is a decision asked of
 * someone who is holding a guitar and has seven minutes.
 */
export const HOME_NODE_ID = 'practise.auto';

/**
 * The path from the root to a node, root first, or null when there is no such
 * node. This is the breadcrumb, the back stack and the "where am I" all at
 * once — deriving them from one walk means they cannot disagree.
 */
export function pathTo(id: string, from: NavNode = NAV_ROOT): NavNode[] | null {
  if (from.id === id) return [from];

  for (const child of from.children ?? []) {
    const below = pathTo(id, child);
    if (below) return [from, ...below];
  }

  return null;
}

export function findNode(id: string, from: NavNode = NAV_ROOT): NavNode | null {
  return pathTo(id, from)?.at(-1) ?? null;
}

/** The node one level up, or null at the root. */
export function parentOf(id: string): NavNode | null {
  const path = pathTo(id);
  return path && path.length >= 2 ? path[path.length - 2]! : null;
}

export function isLeaf(node: NavNode): boolean {
  return node.screen !== undefined;
}

/** Every leaf under a node, depth first. Used for search and for tests. */
export function leavesUnder(node: NavNode): NavNode[] {
  if (isLeaf(node)) return [node];
  return (node.children ?? []).flatMap(leavesUnder);
}

/**
 * The location, as it appears in `location.hash`.
 *
 * Hash rather than a path because the app is served from a project page under
 * `/GHAPP/` — a real path would need the server to rewrite unknown paths to
 * index.html, and GitHub Pages will not. The hash survives a reload, a share,
 * and the installed PWA restoring its last screen.
 */
export function hashFor(id: string): string {
  return `#/${id === HOME_NODE_ID ? '' : id}`;
}

/** The node a hash refers to, falling back to home for anything unrecognised. */
export function nodeFromHash(hash: string): NavNode {
  const id = hash.replace(/^#\/?/, '').trim();
  if (!id) return findNode(HOME_NODE_ID)!;
  return findNode(id) ?? findNode(HOME_NODE_ID)!;
}
