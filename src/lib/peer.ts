import Peer from 'peerjs';

let peer: Peer | null = null;

export const initPeer = (id?: string) => {
  if (peer && !peer.destroyed) return peer;
  
  peer = new Peer(id || undefined, {
    debug: 1,
    secure: true,
  });

  peer.on('disconnected', () => {
    console.log('Peer disconnected, attempting to reconnect...');
    peer?.reconnect();
  });

  return peer;
};

export const getPeer = () => peer;

export const destroyPeer = () => {
  if (peer) {
    peer.destroy();
    peer = null;
  }
};
