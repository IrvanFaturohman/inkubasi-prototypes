import * as THREE from 'three';
import type { MaterialKind, ThemeKind } from '../game/types';

/** Palet warna per tema (cerah, toy-like, kontras cukup untuk layar ponsel). */
export interface ThemePalette {
  sky: string;
  fog: string;
  ground: string;
  groundAlt: string;
  road: string;
  roadEdge: string;
  roadDash: string;
  curbA: string;
  curbB: string;
  site: string;
  bush: string[];
  foliage: string[];
  trunk: string;
  flower: string[];
  rock: string;
}

export const THEMES: Record<ThemeKind, ThemePalette> = {
  forest: {
    sky: '#bfe7ff',
    fog: '#bfe3c8',
    ground: '#8fd16a',
    groundAlt: '#83c65f',
    road: '#b9b3a6',
    roadEdge: '#d6d0c2',
    roadDash: '#fbf7ec',
    curbA: '#ffffff',
    curbB: '#f06a55',
    site: '#dcc08f',
    bush: ['#5db84f', '#4fa845', '#6cc65a'],
    foliage: ['#4fae4a', '#3f9b45', '#62c057', '#2f8a4a'],
    trunk: '#8a5a36',
    flower: ['#ff7aa2', '#ffd24a', '#ffffff', '#b388ff'],
    rock: '#b6b2aa',
  },
  meadow: {
    sky: '#c8ecff',
    fog: '#d8ecc0',
    ground: '#a3d76b',
    groundAlt: '#97cc60',
    road: '#bdb0a0',
    roadEdge: '#dccfbc',
    roadDash: '#fffaf0',
    curbA: '#ffffff',
    curbB: '#3fa6d9',
    site: '#e2c898',
    bush: ['#68bd52', '#58ad48', '#7bcb61'],
    foliage: ['#6cbf4f', '#8fd05a', '#4fa845', '#f2b84b'],
    trunk: '#9a6a44',
    flower: ['#ffd24a', '#ff8f6b', '#ffffff', '#ff7aa2'],
    rock: '#c2bcb0',
  },
  city: {
    sky: '#cfe8ff',
    fog: '#dfe5ea',
    ground: '#e6e0d4',
    groundAlt: '#d9d2c4',
    road: '#7c8594',
    roadEdge: '#a3abb8',
    roadDash: '#ffd84a',
    curbA: '#f4f4f4',
    curbB: '#c9ced6',
    site: '#d8cbb4',
    bush: ['#5fb34f', '#4fa244', '#72c160'],
    foliage: ['#5fb34f', '#4fa244', '#7ccf62'],
    trunk: '#7a5236',
    flower: ['#ff6f91', '#ffd24a', '#ffffff', '#7fb7ff'],
    rock: '#b7bcc4',
  },
};

/** Warna per tingkat kendaraan (Lv1..Lv6). */
export const VEHICLE_COLORS = ['#3d9bff', '#ffab1f', '#ff5a5f', '#9b6bff', '#18c79a', '#ff6fcf'];

export const MATERIAL_LOOK: Record<MaterialKind, { main: string; alt: string; end: string; label: string; unit: string }> = {
  wood: { main: '#b8743f', alt: '#a8652f', end: '#f3d39c', label: 'Kayu', unit: 'kayu' },
  brick: { main: '#d65a3d', alt: '#c24c33', end: '#e9876b', label: 'Bata', unit: 'bata' },
};

/** Material bersama (hemat draw state & shader program). */
export const SHARED = {
  vertexStd: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }),
  vertexLambert: new THREE.MeshLambertMaterial({ vertexColors: true }),
  invisible: new THREE.MeshBasicMaterial({ visible: false }),
};
