import React, { Suspense } from 'react';
import FixedHeader from './FixedHeader';
import CollapsibleSidebar from './CollapsibleSidebar';
import MobileBottomNav from './MobileBottomNav';
import SoundPermissionHelper from '@/components/notifications/SoundPermissionHelper';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import PageContentSkeleton from '@/components/ui/page-content-skeleton';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const DashboardLayoutContent: React.FC<DashboardLayoutProps> = ({ children }) => {
  const { isOpen, isMobile, isPinned, closeSidebar } = useSidebar();

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-gradient-to-br from-[var(--app-primary-soft)] via-white to-[var(--app-surface)] dark:from-[#07110d] dark:via-[#0b1512] dark:to-[#101c17]">
      <FixedHeader />
      
      {/* Overlay para mobile */}
      {isMobile && isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={closeSidebar}
        />
      )}
      
      <div className="flex w-full">
        <CollapsibleSidebar />
        <main className={`
          flex-1 transition-all duration-300 min-w-0 w-full
          ${isMobile 
            ? 'ml-0 pt-[60px]' 
            : isOpen
              ? 'ml-64 pt-16' 
              : 'ml-16 pt-16'
          }
        `}>
          <div className={`${isMobile ? 'min-h-[calc(100vh-60px)] bg-[var(--app-surface)]' : 'h-[calc(100vh-64px)]'} w-full`}>
            <div
              className={`
                mobile-safe-x h-full w-full max-w-full
                ${isMobile ? 'mobile-safe-bottom px-3 py-3 pb-32' : 'px-4 py-4 sm:px-6 sm:py-6'}
              `}
            >
              <Suspense fallback={<PageContentSkeleton />}>
                {children}
              </Suspense>
            </div>
          </div>
        </main>
      </div>
      <MobileBottomNav />
      <SoundPermissionHelper />
    </div>
  );
};


const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  return (
    <SidebarProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
};


export default DashboardLayout;
