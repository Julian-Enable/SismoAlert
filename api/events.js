import { getState } from './store.js';

export default async function handler(req, res) {
  const state = await getState();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ events: state.events.slice(0, 30) });
}