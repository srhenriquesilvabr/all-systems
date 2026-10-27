// Fotos de demonstração para veículos e imóveis: ilustrações em photos/ (geradas a partir de
// SVG próprio, sem direitos de terceiros). Só envia para quem ainda não tem foto.
import { readFileSync } from 'node:fs';
import { step } from './lib.mjs';

const photo = (name) => readFileSync(new URL(`./photos/${name}.png`, import.meta.url));

const CAR_COLORS = { prata: 'prata', branco: 'branco', preto: 'preto', vermelho: 'vermelho', vermelha: 'vermelho', azul: 'azul', cinza: 'cinza', grafite: 'cinza', chumbo: 'cinza' };

function vehiclePhoto(v) {
  const color = Object.entries(CAR_COLORS).find(([k]) => (v.color ?? '').toLowerCase().includes(k))?.[1];
  if (v.kind === 'motorcycle') return `moto-${color === 'azul' ? 'azul' : color === 'preto' ? 'preta' : 'vermelha'}`;
  return `carro-${color ?? ['prata', 'branco', 'preto', 'cinza'][v.plate ? v.plate.charCodeAt(3) % 4 : 0]}`;
}

const PROPERTY_PHOTO = { apartment: 'apartamento', house: 'casa', condo_house: 'casa-condominio', land: 'terreno', rural: 'terreno', commercial: 'loja', office: 'sala-comercial' };

export async function seedVehiclePhotos({ api, log }) {
  await step(log, 'fotos dos veículos', async () => {
    const list = (await api.get('/vehicles/stock')).filter((v) => !v.photos?.length);
    for (const v of list) await api.upload(`/vehicles/stock/${v.id}/photos`, 'photo', photo(vehiclePhoto(v)), `${vehiclePhoto(v)}.png`, 'image/png');
    log(`    ${list.length} veículo(s) com foto nova`);
  });
}

export async function seedPropertyPhotos({ api, log }) {
  await step(log, 'fotos dos imóveis', async () => {
    const res = await api.get('/real-estate/properties');
    const list = (res.items ?? res).filter((p) => !p.photos?.length);
    for (const p of list) {
      const name = PROPERTY_PHOTO[p.type] ?? 'casa';
      await api.upload(`/real-estate/properties/${p.id}/photos`, 'photo', photo(name), `${name}.png`, 'image/png');
    }
    log(`    ${list.length} imóvel(is) com foto nova`);
  });
}
