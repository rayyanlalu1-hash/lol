/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import MeetingRoom from './components/MeetingRoom';
import { Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

function AnimatedRoutes() {
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
        >
          <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div key="app-wrapper" className="w-full h-full">
        <Routes location={location}>
          <Route 
            path="/auth" 
            element={
              <PageWrapper>
                {!user ? <Auth /> : <Navigate to="/" />}
              </PageWrapper>
            } 
          />
          <Route 
            path="/" 
            element={
              <PageWrapper>
                {user ? <Dashboard /> : <Navigate to="/auth" />}
              </PageWrapper>
            } 
          />
          <Route 
            path="/meeting/:id" 
            element={
              <PageWrapper>
                {user ? <MeetingRoom /> : <Navigate to="/auth" />}
              </PageWrapper>
            } 
          />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="w-full h-full"
    >
      {children}
    </motion.div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}
