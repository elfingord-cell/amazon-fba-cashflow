
export class NoopSyncAdapter {
  constructor(){ this._status = "offline"; }
  async pull(){ return null; }
  async push(_snapshot){ return { ok: true }; }
  get status(){ return this._status; }
}
