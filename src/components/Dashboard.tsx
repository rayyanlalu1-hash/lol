import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { collection, addDoc, query, where, onSnapshot, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/error-handler';
import { motion, AnimatePresence } from 'motion/react';
import { updateProfile } from 'firebase/auth';
import { 
  Video, 
  Plus, 
  LogOut, 
  Settings, 
  Search,
  ArrowRight,
  Monitor,
  Loader2,
  Trash2,
  X,
  User,
  Check
} from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<any[]>([]);
  const [newMeetingTitle, setNewMeetingTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState(auth.currentUser?.displayName || '');
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'meetings'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const meetingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMeetings(meetingsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'meetings');
    });

    return () => unsubscribe();
  }, []);

  const createMeeting = async () => {
    if (!newMeetingTitle.trim()) return;
    setLoading(true);
    try {
      const docRef = await addDoc(collection(db, 'meetings'), {
        title: newMeetingTitle,
        hostId: auth.currentUser?.uid,
        hostName: auth.currentUser?.displayName,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      navigate(`/meeting/${docRef.id}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'meetings');
    } finally {
      setLoading(false);
    }
  };

  const deleteMeeting = async (meetingId: string) => {
    try {
      await deleteDoc(doc(db, 'meetings', meetingId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `meetings/${meetingId}`);
    }
  };

  const handleUpdateUsername = async () => {
    if (!newDisplayName.trim() || !auth.currentUser) return;
    setIsUpdatingName(true);
    try {
      await updateProfile(auth.currentUser, { displayName: newDisplayName });
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

  return (
    <div className="min-h-screen bg-slate-950 flex overflow-hidden">
      {/* Sidebar */}
      <motion.aside 
        initial={{ x: -100 }}
        animate={{ x: 0 }}
        className="w-20 lg:w-64 bg-slate-900 border-r border-slate-800 flex flex-col p-4 shrink-0"
      >
        <div className="flex items-center gap-3 px-2 mb-10">
          <motion.div 
            whileHover={{ rotate: 180 }}
            className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0"
          >
            <Monitor className="text-white w-6 h-6" />
          </motion.div>
          <span className="hidden lg:block font-bold text-xl text-indigo-500">Theldenny</span>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem icon={<Video />} label="Meetings" active onClick={() => {}} />
          <SidebarItem icon={<Settings />} label="Settings" onClick={() => setShowSettings(true)} />
        </nav>

        <button 
          onClick={() => signOut(auth)}
          className="flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all group"
        >
          <LogOut className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span className="hidden lg:block font-medium">Sign Out</span>
        </button>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto scroll-smooth">
        <motion.header 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10"
        >
          <div>
            <h2 className="text-3xl font-bold text-white mb-1">Welcome back, {auth.currentUser?.displayName}</h2>
            <p className="text-slate-400">Start or join a high-performance session</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search meetings..." 
                className="bg-slate-900 border border-slate-800 rounded-xl py-2 pl-10 pr-4 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Create Meeting Card */}
          <motion.section 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-1"
          >
            <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-3xl p-8 text-white shadow-xl shadow-indigo-500/20 sticky top-0">
              <h3 className="text-2xl font-bold mb-4">Start a New Meeting</h3>
              <p className="text-indigo-100 mb-6">Create a room and share the link with your team.</p>
              
              <div className="space-y-4">
                <input 
                  type="text" 
                  placeholder="Meeting Title" 
                  value={newMeetingTitle}
                  onChange={(e) => setNewMeetingTitle(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl py-3 px-4 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/50 transition-all"
                />
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={createMeeting}
                  disabled={loading}
                  className="w-full bg-white text-indigo-600 font-bold py-3 rounded-xl hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 shadow-lg"
                >
                  {loading ? <Loader2 className="animate-spin" /> : <Plus />}
                  Create Meeting
                </motion.button>
              </div>
            </div>
          </motion.section>

          {/* Active Meetings List */}
          <section className="lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Active Sessions</h3>
              <span className="text-sm text-indigo-400 font-medium">{meetings.length} live now</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout">
                {meetings.length > 0 ? (
                  meetings.map((meeting, index) => (
                    <motion.div 
                      key={meeting.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ delay: index * 0.05 }}
                      className="bg-slate-900 border border-slate-800 p-6 rounded-2xl hover:border-indigo-500/50 transition-all group hover:shadow-2xl hover:shadow-indigo-500/10"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center group-hover:bg-indigo-600/20 transition-colors">
                          <Video className="text-indigo-500 w-6 h-6" />
                        </div>
                        <span className="bg-green-500/10 text-green-500 text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wider animate-pulse">
                          Live
                        </span>
                      </div>
                      <h4 className="text-lg font-bold text-white mb-1">{meeting.title}</h4>
                      <p className="text-slate-400 text-sm mb-6">Hosted by {meeting.hostName}</p>
                      
                      <div className="flex gap-2">
                        <motion.button 
                          whileHover={{ x: 5 }}
                          onClick={() => navigate(`/meeting/${meeting.id}`)}
                          className="flex-1 bg-slate-800 hover:bg-indigo-600 text-white font-semibold py-2 rounded-xl transition-all flex items-center justify-center gap-2 group-hover:shadow-lg group-hover:shadow-indigo-500/20"
                        >
                          Join Now <ArrowRight className="w-4 h-4" />
                        </motion.button>
                        {(isAdmin || meeting.hostId === auth.currentUser?.uid) && (
                          <button 
                            onClick={() => deleteMeeting(meeting.id)}
                            className="p-2 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all"
                            title="Delete Meeting"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="col-span-2 py-20 text-center bg-slate-900/50 border border-dashed border-slate-800 rounded-3xl"
                  >
                    <Video className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-500 font-medium">No active meetings found.</p>
                    <p className="text-slate-600 text-sm">Start one to get the conversation going.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </main>

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
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
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

function SidebarItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
      active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'
    }`}>
      {icon}
      <span className="hidden lg:block font-medium">{label}</span>
    </button>
  );
}
