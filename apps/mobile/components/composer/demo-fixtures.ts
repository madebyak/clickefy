/**
 * Composer demo fixtures — FRONT-END PHASE ONLY.
 *
 * One place for every mock the composer surfaces render while the
 * design settles: the drawer's projects + recents, and each demo
 * project's asset grid. Wiring replaces this file's consumers with the
 * real feeds (`/v1/projects`, `/v1/jobs`) and then deletes it.
 */

import type { DrawerFolder, DrawerRecentRef } from './RecentsDrawer';
import type { ComposerMode } from './sheets';

const IMG = {
  s1c: require('../../assets/onboarding/slide-1-center.png'),
  s1l: require('../../assets/onboarding/slide-1-left.png'),
  s1r: require('../../assets/onboarding/slide-1-right.png'),
  s2a: require('../../assets/onboarding/slide-2-a.png'),
  s2b: require('../../assets/onboarding/slide-2-b.jpg'),
  s2c: require('../../assets/onboarding/slide-2-c.jpg'),
  s2d: require('../../assets/onboarding/slide-2-d.jpg'),
  s2h: require('../../assets/onboarding/slide-2-hero.png'),
  s3f: require('../../assets/onboarding/slide-3-front.jpg'),
  s3m: require('../../assets/onboarding/slide-3-middle.jpg'),
  s3b: require('../../assets/onboarding/slide-3-back.jpg'),
};

export const DEMO_OUTPUTS = [IMG.s2h, IMG.s3f, IMG.s2c, IMG.s1c];

// Folders contain projects (the web studio's folder tree, flattened one
// level for the drawer's accordion).
export const DEMO_FOLDERS: DrawerFolder[] = [
  {
    id: 'f1',
    name: 'Client work',
    projects: [
      { id: 'p1', name: 'Skincare launch', countLabel: '12 items', coverUri: IMG.s2a },
      { id: 'p2', name: 'Ramadan campaign', countLabel: '7 items', coverUri: IMG.s3m },
    ],
  },
  {
    id: 'f2',
    name: 'Experiments',
    projects: [{ id: 'p3', name: 'Product shots', countLabel: '6 items', coverUri: IMG.s2d }],
  },
];

// Recent projects — flat, newest first (auto-titled sessions included).
export const DEMO_RECENT_PROJECTS: DrawerRecentRef[] = [
  { id: 'p4', name: 'Perfume hero shots', when: '2h ago', coverUri: IMG.s2b },
  { id: 'p5', name: 'Sneaker orbit clips', when: '5h ago', coverUri: IMG.s1r },
  { id: 'p1', name: 'Skincare launch', when: 'Yesterday', coverUri: IMG.s2a },
  { id: 'p3', name: 'Product shots', when: '3d ago', coverUri: IMG.s2d },
];

// ─── Project assets ─────────────────────────────────────────────────

export interface DemoAsset {
  id: string;
  kind: ComposerMode;
  /** "3:4" etc — drives the masonry cell height. */
  ratio: string;
  uri: number;
  prompt: string;
}

export interface DemoProjectDetail {
  id: string;
  name: string;
  countLabel: string;
  assets: DemoAsset[];
}

export const DEMO_PROJECT_DETAILS: Record<string, DemoProjectDetail> = {
  p1: {
    id: 'p1',
    name: 'Skincare launch',
    countLabel: '12 items',
    assets: [
      { id: 'a1', kind: 'image', ratio: '3:4', uri: IMG.s2a, prompt: 'Serum bottle on wet marble' },
      { id: 'a2', kind: 'video', ratio: '9:16', uri: IMG.s2b, prompt: 'Slow pour over glass surface' },
      { id: 'a3', kind: 'image', ratio: '1:1', uri: IMG.s2c, prompt: 'Cream jar with orchid shadow' },
      { id: 'a4', kind: 'image', ratio: '3:4', uri: IMG.s2d, prompt: 'Morning light vanity scene' },
      { id: 'a5', kind: 'video', ratio: '16:9', uri: IMG.s2h, prompt: 'Splash reveal, 240fps macro' },
      { id: 'a6', kind: 'image', ratio: '9:16', uri: IMG.s1c, prompt: 'Model holding the serum, beige set' },
      { id: 'a7', kind: 'image', ratio: '1:1', uri: IMG.s1l, prompt: 'Flat-lay with eucalyptus' },
      { id: 'a8', kind: 'video', ratio: '9:16', uri: IMG.s1r, prompt: 'Droplet orbit, gold accent' },
      { id: 'a9', kind: 'image', ratio: '3:4', uri: IMG.s3f, prompt: 'Bathroom shelf hero shot' },
      { id: 'a10', kind: 'image', ratio: '3:4', uri: IMG.s3m, prompt: 'Sunset window reflection' },
      { id: 'a11', kind: 'video', ratio: '16:9', uri: IMG.s3b, prompt: 'Steam rising, spa mood' },
      { id: 'a12', kind: 'image', ratio: '1:1', uri: IMG.s2a, prompt: 'Ingredient macro: hyaluron' },
    ],
  },
  p2: {
    id: 'p2',
    name: 'Ramadan campaign',
    countLabel: '7 items',
    assets: [
      { id: 'b1', kind: 'image', ratio: '9:16', uri: IMG.s3m, prompt: 'Lantern table setting, dusk' },
      { id: 'b2', kind: 'video', ratio: '9:16', uri: IMG.s3b, prompt: 'Dates and coffee, slow dolly' },
      { id: 'b3', kind: 'image', ratio: '1:1', uri: IMG.s3f, prompt: 'Gift box with crescent embossing' },
      { id: 'b4', kind: 'image', ratio: '3:4', uri: IMG.s2c, prompt: 'Family table spread, warm light' },
      { id: 'b5', kind: 'video', ratio: '16:9', uri: IMG.s2h, prompt: 'Product reveal under lantern glow' },
      { id: 'b6', kind: 'image', ratio: '3:4', uri: IMG.s1c, prompt: 'Eid packaging lineup' },
      { id: 'b7', kind: 'image', ratio: '1:1', uri: IMG.s2b, prompt: 'Crescent bokeh close-up' },
    ],
  },
  p4: {
    id: 'p4',
    name: 'Perfume hero shots',
    countLabel: '3 items',
    assets: [
      { id: 'd1', kind: 'image', ratio: '3:4', uri: IMG.s2b, prompt: 'Perfume bottle on wet marble' },
      { id: 'd2', kind: 'image', ratio: '9:16', uri: IMG.s2c, prompt: 'Amber light through glass' },
      { id: 'd3', kind: 'video', ratio: '9:16', uri: IMG.s2h, prompt: 'Mist burst in slow motion' },
    ],
  },
  p5: {
    id: 'p5',
    name: 'Sneaker orbit clips',
    countLabel: '2 items',
    assets: [
      { id: 'e1', kind: 'video', ratio: '16:9', uri: IMG.s1r, prompt: 'Studio smoke 360 orbit' },
      { id: 'e2', kind: 'video', ratio: '9:16', uri: IMG.s1l, prompt: 'Vertical drop bounce' },
    ],
  },
  p3: {
    id: 'p3',
    name: 'Product shots',
    countLabel: '6 items',
    assets: [
      { id: 'c1', kind: 'image', ratio: '1:1', uri: IMG.s2d, prompt: 'White cyc, hard shadow' },
      { id: 'c2', kind: 'image', ratio: '3:4', uri: IMG.s1l, prompt: 'Floating product, pastel' },
      { id: 'c3', kind: 'video', ratio: '9:16', uri: IMG.s1r, prompt: '360 turntable, chrome' },
      { id: 'c4', kind: 'image', ratio: '16:9', uri: IMG.s2h, prompt: 'Banner crop, duo tone' },
      { id: 'c5', kind: 'image', ratio: '3:4', uri: IMG.s2a, prompt: 'Stacked composition' },
      { id: 'c6', kind: 'image', ratio: '9:16', uri: IMG.s3f, prompt: 'Story format teaser' },
    ],
  },
};
