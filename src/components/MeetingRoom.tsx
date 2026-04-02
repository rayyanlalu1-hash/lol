import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  deleteDoc, 
  collection, 
  query, 
  where,
  updateDoc
} from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/error-handler';
import { initPeer, destroyPeer } from '../lib/peer';
import { updateProfile } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Monitor, 
  PhoneOff, 
  Users, 
  MessageSquare,
  Maximize2,
  Settings,
  MoreVertical,
  Shield,
  Loader2,
  X,
  User,
  Check,
  Trash2
} from 'lucide-react';

export default function MeetingRoom() {
  const { id: meetingId } = useParams();
  const navigate = useNavigate();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [preJoin, setPreJoin] = useState(true);
  const [initialMic, setInitialMic] = useState(true);
  const [initialVideo, setInitialVideo] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState(auth.currentUser?.displayName || '');
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [fullScreenUid, setFullScreenUid] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<any>(null);
  const callsRef = useRef<Map<string, any>>(new Map());

  // Get devices on mount
  useEffect(() => {
    const getDevices = async () => {
      try {
        // Request permissions first to get labels
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        const devs = await navigator.mediaDevices.enumerateDevices();
        setDevices(devs);
        
        const videoDev = devs.find(d => d.kind === 'videoinput');
        const audioDev = devs.find(d => d.kind === 'audioinput');
        if (videoDev && !selectedVideoId) setSelectedVideoId(videoDev.deviceId);
        if (audioDev && !selectedAudioId) setSelectedAudioId(audioDev.deviceId);
      } catch (err) {
        console.error("Error enumerating devices:", err);
      }
    };
    getDevices();
  }, []);

  // Preview stream for pre-join
  useEffect(() => {
    if (!preJoin) return;

    let previewStream: MediaStream | null = null;

    const startPreview = async () => {
      try {
        const constraints = {
          video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true,
          audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true
        };
        previewStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = previewStream;
        }
        // Apply initial toggles to preview
        previewStream.getAudioTracks().forEach(t => t.enabled = initialMic);
        previewStream.getVideoTracks().forEach(t => t.enabled = initialVideo);
      } catch (err) {
        console.error("Error starting preview:", err);
      }
    };

    startPreview();

    return () => {
      if (previewStream) {
        previewStream.getTracks().forEach(t => t.stop());
      }
    };
  }, [preJoin, selectedVideoId, selectedAudioId, initialMic, initialVideo]);

  // Sync local video ref with stream whenever stream or joining state changes
  useEffect(() => {
    if (localVideoRef.current && localStream && !preJoin) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isJoining, preJoin]);

  const startMeeting = async () => {
    if (!meetingId || !auth.currentUser) return;
    setIsJoining(true);
    setPreJoin(false);

    try {
      // 1. Get local media with selected devices
      const constraints = {
        video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true,
        audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Apply initial toggles
      stream.getAudioTracks().forEach(t => t.enabled = initialMic);
      stream.getVideoTracks().forEach(t => t.enabled = initialVideo);
      setIsMuted(!initialMic);
      setIsVideoOff(!initialVideo);
      
      setLocalStream(stream);

      // 2. Initialize Peer
      const peer = initPeer();
      peerRef.current = peer;

      peer.on('open', async (peerId: string) => {
        // 3. Register as participant
        const participantPath = `meetings/${meetingId}/participants/${auth.currentUser?.uid}`;
        const pDoc = doc(db, `meetings/${meetingId}/participants`, auth.currentUser?.uid || '');
        try {
          await setDoc(pDoc, {
            uid: auth.currentUser?.uid,
            peerId: peerId,
            name: auth.currentUser?.displayName,
            joinedAt: new Date().toISOString(),
          });
          setIsJoining(false);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, participantPath);
        }
      });

      // 4. Listen for other participants
      const q = collection(db, `meetings/${meetingId}/participants`);
      const unsubscribeParticipants = onSnapshot(q, (snapshot) => {
        const pList = snapshot.docs.map(doc => doc.data());
        setParticipants(pList);

        snapshot.docs.forEach(doc => {
          const data = doc.data();
          const remotePeerId = data.peerId;
          const remoteUid = data.uid;
          
          if (remoteUid !== auth.currentUser?.uid && remotePeerId && !callsRef.current.has(remoteUid)) {
            const call = peer.call(remotePeerId, stream);
            handleCall(call, remoteUid);
          }
        });
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `meetings/${meetingId}/participants`);
      });

      // 5. Handle incoming calls
      peer.on('call', (call: any) => {
        call.answer(stream);
        handleCall(call, call.peer);
      });
    } catch (err) {
      console.error("Failed to start meeting:", err);
      navigate('/');
    }
  };

  useEffect(() => {
    return () => {
      if (peerRef.current) {
        peerRef.current.destroy();
      }
      destroyPeer();
    };
  }, []);

  // Separate effect for stream cleanup to ensure it always runs with latest stream
  useEffect(() => {
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
          console.log(`Cleanup: Stopped track ${track.kind}`);
        });
      }
    };
  }, [localStream]);

  const handleCall = (call: any, remoteUid: string) => {
    call.on('stream', (remoteStream: MediaStream) => {
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.set(remoteUid, remoteStream);
        return next;
      });
    });

    call.on('close', () => {
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.delete(remoteUid);
        return next;
      });
      callsRef.current.delete(remoteUid);
    });

    callsRef.current.set(remoteUid, call);
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!audioTracks[0].enabled);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!videoTracks[0].enabled);
    }
  };

  const shareScreen = async () => {
    try {
      if (isScreenSharing) {
        // Switch back to camera
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        replaceStream(stream);
        setIsScreenSharing(false);
      } else {
        const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
        replaceStream(screenStream);
        setIsScreenSharing(true);
        
        screenStream.getVideoTracks()[0].onended = () => {
          shareScreen(); // Toggle back
        };
      }
    } catch (err) {
      console.error(err);
    }
  };

  const replaceStream = (newStream: MediaStream) => {
    if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
    
    // Ensure the new stream respects current mute/video settings
    newStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    newStream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
    
    setLocalStream(newStream);
    
    callsRef.current.forEach(call => {
      const videoTrack = newStream.getVideoTracks()[0];
      const audioTrack = newStream.getAudioTracks()[0];
      
      const videoSender = call.peerConnection.getSenders().find((s: any) => s.track?.kind === 'video');
      const audioSender = call.peerConnection.getSenders().find((s: any) => s.track?.kind === 'audio');
      
      if (videoSender && videoTrack) videoSender.replaceTrack(videoTrack);
      if (audioSender && audioTrack) audioSender.replaceTrack(audioTrack);
    });
  };

  const changeDevice = async (kind: 'videoinput' | 'audioinput', deviceId: string) => {
    if (kind === 'videoinput') setSelectedVideoId(deviceId);
    else setSelectedAudioId(deviceId);

    try {
      const constraints = {
        video: kind === 'videoinput' ? { deviceId: { exact: deviceId } } : (selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true),
        audio: kind === 'audioinput' ? { deviceId: { exact: deviceId } } : (selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true)
      };
      
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Stop old tracks of the same kind
      if (localStream) {
        localStream.getTracks().forEach(track => {
          if (track.kind === (kind === 'videoinput' ? 'video' : 'audio')) {
            track.stop();
          }
        });
      }
      
      replaceStream(newStream);
    } catch (err) {
      console.error("Error changing device:", err);
    }
  };

  const leaveMeeting = async () => {
    setIsEnding(true);
    
    // Smooth delay for animation
    setTimeout(async () => {
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
          console.log(`Stopped track: ${track.label}`);
        });
      }
      
      if (meetingId && auth.currentUser) {
        try {
          await deleteDoc(doc(db, `meetings/${meetingId}/participants`, auth.currentUser.uid));
        } catch (e) {
          console.error("Error removing participant:", e);
        }
      }
      
      destroyPeer();
      navigate('/');
    }, 1500);
  };

  const handleUpdateUsername = async () => {
    if (!newDisplayName.trim() || !auth.currentUser || !meetingId) return;
    setIsUpdatingName(true);
    try {
      // Update Firebase Auth
      await updateProfile(auth.currentUser, { displayName: newDisplayName });
      
      // Update Firestore Participant
      const pDoc = doc(db, `meetings/${meetingId}/participants`, auth.currentUser.uid);
      await updateDoc(pDoc, { name: newDisplayName });
      
      // Update Firestore User Profile
      const uDoc = doc(db, 'users', auth.currentUser.uid);
      await updateDoc(uDoc, { displayName: newDisplayName });
      
      setShowSettings(false);
    } catch (err) {
      console.error("Error updating username:", err);
    } finally {
      setIsUpdatingName(false);
    }
  };

  const isAdmin = auth.currentUser?.email === 'rayyanlalu1@gmail.com';

  if (isEnding) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center p-4 overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -200 }}
          transition={{ type: "spring", damping: 20, stiffness: 100 }}
          className="text-center"
        >
          <div className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-red-500/40">
            <PhoneOff className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-3">Call Ended</h2>
          <p className="text-slate-400 text-lg">Returning to home screen...</p>
        </motion.div>
      </div>
    );
  }

  if (preJoin) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center p-6 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-center py-8"
        >
          {/* Preview Section */}
          <div className="space-y-6">
            <div className="relative aspect-video bg-slate-900 rounded-[2rem] overflow-hidden border-2 border-slate-800 shadow-2xl group">
              <video 
                ref={localVideoRef} 
                autoPlay 
                muted 
                playsInline 
                className={`w-full h-full object-cover transition-opacity duration-500 ${!initialVideo ? 'opacity-0' : 'opacity-100'}`}
              />
              {!initialVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                  <div className="w-24 h-24 bg-indigo-600 rounded-full flex items-center justify-center text-3xl font-bold text-white shadow-2xl">
                    {auth.currentUser?.displayName?.charAt(0)}
                  </div>
                </div>
              )}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4">
                <button 
                  onClick={() => setInitialMic(!initialMic)}
                  className={`p-4 rounded-2xl transition-all ${
                    !initialMic ? 'bg-red-500 text-white' : 'bg-white/10 backdrop-blur-md text-white hover:bg-white/20'
                  }`}
                >
                  {initialMic ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                </button>
                <button 
                  onClick={() => setInitialVideo(!initialVideo)}
                  className={`p-4 rounded-2xl transition-all ${
                    !initialVideo ? 'bg-red-500 text-white' : 'bg-white/10 backdrop-blur-md text-white hover:bg-white/20'
                  }`}
                >
                  {initialVideo ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
              </div>
            </div>
          </div>

          {/* Setup Section */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-[2.5rem] p-8 lg:p-10 backdrop-blur-xl">
            <div className="mb-8 text-center lg:text-left">
              <h2 className="text-3xl font-bold text-white mb-2">Ready to join?</h2>
              <p className="text-slate-400">Check your audio and video settings before entering the meeting.</p>
            </div>

            <div className="space-y-6 mb-10">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Camera</label>
                <select
                  value={selectedVideoId}
                  onChange={(e) => setSelectedVideoId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
                >
                  {devices.filter(d => d.kind === 'videoinput').map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${device.deviceId.slice(0, 5)}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Microphone</label>
                <select
                  value={selectedAudioId}
                  onChange={(e) => setSelectedAudioId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
                >
                  {devices.filter(d => d.kind === 'audioinput').map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 5)}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button 
              onClick={startMeeting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-5 rounded-2xl transition-all shadow-xl shadow-indigo-500/20 active:scale-[0.98] text-lg"
            >
              Join Meeting
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isJoining) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center p-6 overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-2xl flex flex-col items-center"
        >
          {/* Camera Preview during joining */}
          <div className="w-full aspect-video bg-slate-900 rounded-[2rem] overflow-hidden border-2 border-slate-800 mb-8 shadow-2xl relative group">
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              playsInline 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                </div>
                <span className="text-white font-medium">Connecting to secure server...</span>
              </div>
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-3xl font-bold text-white mb-3">Theldenny Secure Meeting</h2>
            <p className="text-slate-400 text-lg">Setting up your P2P connection for meeting: <span className="text-indigo-400">{meetingId}</span></p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-950 flex flex-col overflow-hidden">
      {/* Header */}
      <AnimatePresence>
        {!fullScreenUid && (
          <motion.header 
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shrink-0 z-10"
          >
            <div className="flex items-center gap-4">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold text-sm">Theldenny Secure Meeting</h1>
                <p className="text-slate-400 text-xs">ID: {meetingId}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="bg-slate-800 px-3 py-1.5 rounded-full flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-white">{participants.length}</span>
              </div>
              {isAdmin && (
                <button 
                  onClick={() => {
                    if (meetingId) {
                      deleteDoc(doc(db, 'meetings', meetingId));
                      navigate('/');
                    }
                  }}
                  className="p-2 hover:bg-red-500/10 rounded-lg text-red-500 transition-colors"
                  title="Delete Meeting (Admin)"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* Video Grid */}
      <main className={`flex-1 overflow-y-auto bg-slate-950 scroll-smooth relative ${fullScreenUid ? 'p-0' : 'p-4'}`}>
        <motion.div 
          layout
          className={`grid gap-4 h-full min-h-[400px] ${
            remoteStreams.size === 0 ? 'grid-cols-1' : 
            remoteStreams.size === 1 ? 'grid-cols-1 md:grid-cols-2' : 
            'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {/* Local Video */}
          <motion.div 
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => setFullScreenUid(fullScreenUid === 'local' ? null : 'local')}
            className={`relative bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 group aspect-video shadow-xl cursor-pointer transition-all duration-500 ${
              fullScreenUid === 'local' ? 'fixed inset-0 z-40 !aspect-auto !rounded-none !border-0' : ''
            }`}
          >
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              playsInline 
              className={`w-full h-full object-cover transition-opacity duration-500 ${isVideoOff ? 'opacity-0' : 'opacity-100'}`}
            />
            <AnimatePresence>
              {isVideoOff && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-slate-900"
                >
                  <div className="w-24 h-24 bg-indigo-600 rounded-full flex items-center justify-center text-3xl font-bold text-white shadow-2xl">
                    {auth.currentUser?.displayName?.charAt(0)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-md px-3 py-1 rounded-lg text-xs font-medium text-white flex items-center gap-2 border border-white/10">
              {auth.currentUser?.displayName} (You)
              {isMuted && <MicOff className="w-3 h-3 text-red-400" />}
            </div>

            {fullScreenUid === 'local' && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setFullScreenUid(null);
                }}
                className="absolute top-6 left-6 z-50 bg-black/50 backdrop-blur-md p-3 rounded-2xl text-white hover:bg-black/70 transition-all border border-white/10"
              >
                <X className="w-6 h-6" />
              </button>
            )}

            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="bg-black/50 backdrop-blur-md p-2 rounded-lg text-white">
                <Maximize2 className="w-4 h-4" />
              </div>
            </div>
          </motion.div>

          {/* Remote Videos */}
          <AnimatePresence mode="popLayout">
            {Array.from(remoteStreams.entries()).map(([uid, stream]) => (
              <motion.div
                key={uid}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                onClick={() => setFullScreenUid(fullScreenUid === uid ? null : uid)}
                className={`cursor-pointer group relative ${
                  fullScreenUid === uid ? 'fixed inset-0 z-40' : ''
                }`}
              >
                <RemoteVideo stream={stream} uid={uid} participants={participants} isFullScreen={fullScreenUid === uid} />
                
                {fullScreenUid === uid && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullScreenUid(null);
                    }}
                    className="absolute top-6 left-6 z-50 bg-black/50 backdrop-blur-md p-3 rounded-2xl text-white hover:bg-black/70 transition-all border border-white/10"
                  >
                    <X className="w-6 h-6" />
                  </button>
                )}

                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-black/50 backdrop-blur-md p-2 rounded-lg text-white">
                    <Maximize2 className="w-4 h-4" />
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      </main>

      {/* Controls */}
      <AnimatePresence>
        {!fullScreenUid && (
          <motion.footer 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="h-24 bg-slate-900 border-t border-slate-800 flex items-center justify-center px-6 shrink-0 z-10 relative"
          >
            <div className="flex items-center gap-4">
              <div className="relative">
                <ControlButton 
                  icon={isMuted ? <MicOff /> : <Mic />} 
                  active={!isMuted} 
                  onClick={toggleMute}
                  danger={isMuted}
                />
                <button 
                  onClick={() => setShowDevices(!showDevices)}
                  className="absolute -top-1 -right-1 bg-slate-800 rounded-full p-1 border border-slate-700 hover:bg-slate-700 transition-colors"
                >
                  <MoreVertical className="w-3 h-3 text-slate-400" />
                </button>
                
                <AnimatePresence>
                  {showDevices && (
                    <motion.div 
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="absolute bottom-full mb-4 left-0 bg-slate-900 border border-slate-800 rounded-2xl p-4 w-64 shadow-2xl z-50"
                    >
                      <div className="space-y-4">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Camera</label>
                          <select
                            value={selectedVideoId}
                            onChange={(e) => {
                              changeDevice('videoinput', e.target.value);
                              setShowDevices(false);
                            }}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                          >
                            {devices.filter(d => d.kind === 'videoinput').map(device => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Camera ${device.deviceId.slice(0, 5)}`}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Microphone</label>
                          <select
                            value={selectedAudioId}
                            onChange={(e) => {
                              changeDevice('audioinput', e.target.value);
                              setShowDevices(false);
                            }}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                          >
                            {devices.filter(d => d.kind === 'audioinput').map(device => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Mic ${device.deviceId.slice(0, 5)}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <ControlButton 
                icon={isVideoOff ? <VideoOff /> : <Video />} 
                active={!isVideoOff} 
                onClick={toggleVideo}
                danger={isVideoOff}
              />
              <ControlButton 
                icon={<Monitor />} 
                active={isScreenSharing} 
                onClick={shareScreen}
                label="Share Screen"
              />
              <div className="w-px h-8 bg-slate-800 mx-2" />
              <button 
                onClick={leaveMeeting}
                className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-red-500/20 active:scale-95"
              >
                <PhoneOff className="w-5 h-5" />
                End Call
              </button>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Settings className="w-6 h-6 text-indigo-500" />
                  Account Settings
                </h3>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                    <User className="w-4 h-4" /> Change Username
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      placeholder="Enter new username"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                    <button 
                      onClick={handleUpdateUsername}
                      disabled={isUpdatingName}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white p-3 rounded-xl transition-all disabled:opacity-50"
                    >
                      {isUpdatingName ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Quick Device Switch</p>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => {
                        setShowSettings(false);
                        setShowDevices(true);
                      }}
                      className="bg-slate-800 hover:bg-slate-700 p-4 rounded-2xl text-slate-400 flex flex-col items-center gap-2 transition-all"
                    >
                      <Video className="w-5 h-5" />
                      <span className="text-[10px] font-bold uppercase">Camera</span>
                    </button>
                    <button 
                      onClick={() => {
                        setShowSettings(false);
                        setShowDevices(true);
                      }}
                      className="bg-slate-800 hover:bg-slate-700 p-4 rounded-2xl text-slate-400 flex flex-col items-center gap-2 transition-all"
                    >
                      <Mic className="w-5 h-5" />
                      <span className="text-[10px] font-bold uppercase">Mic</span>
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowSettings(false)}
                className="w-full mt-8 bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl transition-all"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface RemoteVideoProps {
  stream: MediaStream;
  uid: string;
  participants: any[];
  isFullScreen?: boolean;
}

const RemoteVideo: React.FC<RemoteVideoProps> = ({ stream, uid, participants, isFullScreen }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const participant = participants.find(p => p.uid === uid);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className={`relative bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 aspect-video h-full w-full transition-all duration-500 ${
      isFullScreen ? '!aspect-auto !rounded-none !border-0' : ''
    }`}>
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-md px-3 py-1 rounded-lg text-xs font-medium text-white border border-white/10">
        {participant?.name || 'Guest'}
      </div>
    </div>
  );
};

interface ControlButtonProps {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
  label?: string;
}

const ControlButton: React.FC<ControlButtonProps> = ({ icon, active, onClick, danger = false, label }) => {
  return (
    <div className="flex flex-col items-center gap-1">
      <button 
        onClick={onClick}
        className={`p-4 rounded-2xl transition-all flex items-center justify-center ${
          danger ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' :
          active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-500' : 
          'bg-slate-800 text-slate-400 hover:bg-slate-700'
        }`}
      >
        {icon}
      </button>
      {label && <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>}
    </div>
  );
};
