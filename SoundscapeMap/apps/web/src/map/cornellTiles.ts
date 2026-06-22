import { CORNELL_BUILDING_TILE_IDS } from './data/cornellBuildingTiles';

export const CORNELL_H3_RESOLUTION = 12;

export function cornellTileIds() {
  return [...CORNELL_BUILDING_TILE_IDS] as string[];
}
