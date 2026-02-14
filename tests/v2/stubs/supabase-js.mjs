export function createClient() {
  return {
    auth: {},
    from: () => ({ select: () => ({}) }),
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
  };
}

export default { createClient };
