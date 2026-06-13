/**
 * i18next resource barrel — assembles every translation namespace for both
 * locales into the shape i18next expects: `{ [lng]: { [ns]: {...} } }`.
 *
 * Each namespace maps to one feature area and lives in
 * `locales/<lng>/<ns>.json`. English is the canonical source + i18next
 * fallback; Arabic mirrors the same key trees. Add a new namespace by
 * creating both JSON files and registering it here + in `NAMESPACES`.
 */

import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enAuth from './locales/en/auth.json';
import enOnboarding from './locales/en/onboarding.json';
import enHome from './locales/en/home.json';
import enLibrary from './locales/en/library.json';
import enProjects from './locales/en/projects.json';
import enSearch from './locales/en/search.json';
import enSaved from './locales/en/saved.json';
import enTemplate from './locales/en/template.json';
import enGenerate from './locales/en/generate.json';
import enProfile from './locales/en/profile.json';
import enPaywall from './locales/en/paywall.json';
import enLegal from './locales/en/legal.json';
import enReport from './locales/en/report.json';

import arCommon from './locales/ar/common.json';
import arErrors from './locales/ar/errors.json';
import arAuth from './locales/ar/auth.json';
import arOnboarding from './locales/ar/onboarding.json';
import arHome from './locales/ar/home.json';
import arLibrary from './locales/ar/library.json';
import arProjects from './locales/ar/projects.json';
import arSearch from './locales/ar/search.json';
import arSaved from './locales/ar/saved.json';
import arTemplate from './locales/ar/template.json';
import arGenerate from './locales/ar/generate.json';
import arProfile from './locales/ar/profile.json';
import arPaywall from './locales/ar/paywall.json';
import arLegal from './locales/ar/legal.json';
import arReport from './locales/ar/report.json';

/** All registered namespaces. `common` is the default. */
export const NAMESPACES = [
  'common',
  'errors',
  'auth',
  'onboarding',
  'home',
  'library',
  'projects',
  'search',
  'saved',
  'template',
  'generate',
  'profile',
  'paywall',
  'legal',
  'report',
] as const;

export const DEFAULT_NS = 'common';

export const resources = {
  en: {
    common: enCommon,
    errors: enErrors,
    auth: enAuth,
    onboarding: enOnboarding,
    home: enHome,
    library: enLibrary,
    projects: enProjects,
    search: enSearch,
    saved: enSaved,
    template: enTemplate,
    generate: enGenerate,
    profile: enProfile,
    paywall: enPaywall,
    legal: enLegal,
    report: enReport,
  },
  ar: {
    common: arCommon,
    errors: arErrors,
    auth: arAuth,
    onboarding: arOnboarding,
    home: arHome,
    library: arLibrary,
    projects: arProjects,
    search: arSearch,
    saved: arSaved,
    template: arTemplate,
    generate: arGenerate,
    profile: arProfile,
    paywall: arPaywall,
    legal: arLegal,
    report: arReport,
  },
} as const;
