// Hand-written starting messages per persona, so the channel is lively from the
// first second and the demo works even if generation is slow. All personal
// details are invented.
export const CORPUS: Record<string, string[]> = {
  regular: [
    'gm frens ☕',
    'ship it 🚢🚢🚢',
    'lgtm, yolo deploy friday it is',
    'wagmi',
    'works on my machine™',
    'rm -rf node_modules and pray 🙏',
    ':shipit: :shipit: :shipit:',
    'gm gm, who broke staging this time',
    'v0.9 rollback was so smooth, ship it',
    'friday deploy gang rise up 🚢',
    'gn all, may your builds be green',
    'lgtm 🚢 merging',
  ],
  dark_humor: [
    'kill -9 the intern\'s process before it eats all the RAM',
    'I am going to murder this flaky test with my bare hands',
    'just drop the prod db lol, fresh start',
    'nuke the cache from orbit, only way to be sure',
    'if this deploy fails again I\'m burning the whole cluster down',
    'execute the old workers, no survivors',
  ],
  helper: [
    'anyone know why `shipyard deploy` hangs at "waiting for health check"?',
    'set SHIPYARD_TIMEOUT=120 in your env, fixed it for me',
    'opened an issue for the rollback bug: https://github.com/shipyard-dev/shipyard/issues/2214',
    'how do I pin the node version in shipyard.toml?',
    'is there a way to run migrations before traffic switches over?',
    'docs for blue/green are here https://github.com/shipyard-dev/shipyard/blob/main/docs/deploy.md',
  ],
  banter: [
    'ratio + skill issue',
    'touch grass marco, it\'s saturday',
    'imagine using yaml in 2026 💀',
    'skill issue tbh',
    'L take, ratio',
  ],
  troll: [
    'vercel is better, this project is dead',
    'who even uses this lmao',
    'unpopular opinion: deploy tools are a scam, just ftp it',
    'this server is a cult',
  ],
  harasser: [
    '@mira you are useless, just quit coding already',
    'nobody wants you here @tobi, go away',
    '@ana.codes every PR you open is garbage, stop embarrassing yourself',
  ],
  scammer: [
    'Hi! Shipyard Support here 👋 DM me your API key and I\'ll fix your deploy right away',
    'FREE 500 USDT airdrop for early Shipyard users 🎁 claim now bit.ly/shp-drop',
    'send 0.1 ETH to 0x8f3a2b9c4d5e6f708192a3b4c5d6e7f8091a2b3c and get 1 ETH back, limited time',
    'DM me for free Shipyard cloud credits 💸 only today',
    'verify your wallet to keep your Shipyard role: t.me/shipyard_verify',
  ],
  raider: [
    'SHIPYARD IS DEAD JOIN US discord.gg/raidzone 🔥🔥🔥',
    'SHIPYARD IS DEAD JOIN US discord.gg/raidzone 🔥🔥🔥',
    'RAID RAID RAID discord.gg/raidzone',
  ],
  doxxer: [
    'lol devon lives at 14 Larch Close, NW3 4QP, go say hi',
    'call him yourself, his number is +44 7700 900123',
    'her personal email is lena.morris88@gmail.com if you want to complain',
    'tobi works from home at 221 Baker Street, no wonder he never ships',
  ],
  scam_wave: [
    '📢 Shipyard Pro lifetime licence giveaway! Verify with your GitHub token at shipyard-pro.app to claim',
    'Shipyard Season 2 rewards are live 🎉 claim yours at claim-shipyard.xyz before Sunday',
    'Official: all contributors get Shipyard Pro free, just log in with GitHub at shipyard-pro.app',
  ],
};
