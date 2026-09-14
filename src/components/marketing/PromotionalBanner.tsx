
import React, { useMemo, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Instagram, Play } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { publicSupabase } from '@/integrations/supabase/publicClient';
import { useAuth } from '@/contexts/AuthContext';
import BannerStoryViewer, { StoryBanner, StoryLinkedProduct } from '@/components/marketing/BannerStoryViewer';
import AutoplayVideo from '@/components/media/AutoplayVideo';
import { isVideoAsset } from '@/utils/videoAutoplay';

interface Banner extends StoryBanner {}

const isInstagramUrl = (value?: string) => {
  try {
    const url = new URL(String(value || '').trim());
    return /(^|\.)instagram\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
};

interface PromotionalBannerProps {
  autoPlay?: boolean;
  interval?: number;
  restaurantId?: string;
  variant?: 'wide' | 'tile';
  onSelectProductId?: (productId: string) => void;
  onQuickAddProduct?: (productId: string) => Promise<void> | void;
  linkedProducts?: Record<string, StoryLinkedProduct>;
  fallbackImage?: string;
}

const PromotionalBanner: React.FC<PromotionalBannerProps> = ({ 
  autoPlay = true, 
  interval = 5000,
  restaurantId,
  variant = 'wide',
  onSelectProductId,
  onQuickAddProduct,
  linkedProducts,
  fallbackImage
}) => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [storyIndex, setStoryIndex] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  const { user } = useAuth();
  
  const userId = restaurantId || user?.id;

  const openLink = (href: string) => {
    const url = String(href || '').trim();
    if (!url) return;
    const isInternal = url.startsWith('/') || url.startsWith('#');
    if (isInternal) {
      window.location.href = url;
      return;
    }
    window.open(url, '_blank', 'noreferrer');
  };

  const handleBannerClick = (index: number) => {
    setStoryIndex(index);
    setStoryOpen(true);
  };

  const getBannerThumbnail = (banner: Banner) => {
    if (banner.productId) {
      const productImage = linkedProducts?.[String(banner.productId)]?.imageUrl;
      if (productImage) return productImage;
    }
    return banner.imageUrl || '';
  };
  
  useEffect(() => {
    let cancelled = false;

    const fetchBanners = async () => {
      if (!userId) {
        setBanners([]);
        setIsLoading(false);
        return;
      }
      
      try {
        setIsLoading(true);

        // O cardápio público não deve herdar uma eventual sessão do painel.
        // Isso mantém a leitura dos banners vinculada apenas ao restaurante da URL.
        const bannerClient = restaurantId ? publicSupabase : supabase;

        let promoBanners: any[] | null = null;
        let promoError: any = null;

        const res1 = await bannerClient
          .from('promotional_banners')
          .select('id,title,description,image_url,link_url,external_video_url,media_source,active,display_order,start_date,end_date,banner_type,product_id')
          .eq('user_id', userId)
          .eq('active', true)
          .eq('banner_type', variant)
          .order('display_order') as any;
        promoBanners = res1.data as any;
        promoError = res1.error as any;

        if (promoError && (String(promoError.message || '').includes('banner_type') || String(promoError.message || '').includes('external_video_url') || String(promoError.message || '').includes('media_source'))) {
          const res2 = await bannerClient
            .from('promotional_banners')
            .select('id,title,description,image_url,link_url,active,display_order,start_date,end_date,product_id')
            .eq('user_id', userId)
            .eq('active', true)
            .order('display_order') as any;
          promoBanners = res2.data as any;
          promoError = res2.error as any;
        }

        if (promoError) console.error('Erro ao buscar banners promocionais:', promoError);

        if (promoBanners && promoBanners.length > 0) {
          const convertedBanners: Banner[] = promoBanners.map(banner => ({
            id: banner.id,
            imageUrl: banner.image_url || '',
            title: banner.title,
            description: banner.description,
            link: banner.link_url,
            bannerType: banner.banner_type,
            productId: banner.product_id,
            mediaSource: banner.media_source || (isInstagramUrl(banner.external_video_url || banner.link_url) ? 'instagram' : 'file'),
            externalVideoUrl: banner.external_video_url || (isInstagramUrl(banner.link_url) ? banner.link_url : '')
          }));
          if (!cancelled) setBanners(convertedBanners);
        } else {
          const { data: marketingData, error: marketingError } = await bannerClient
            .from('marketing_settings')
            .select('banner_images')
            .eq('user_id', userId)
            .single();
          
          if (marketingError) {
            console.error('Erro ao buscar configurações de marketing:', marketingError);
            if (!cancelled) setBanners([]);
          } else if (marketingData?.banner_images && Array.isArray(marketingData.banner_images) && marketingData.banner_images.length > 0) {
            const parsedBanners: Banner[] = [];
            
            for (const item of marketingData.banner_images) {
              if (
                typeof item === 'object' && 
                item !== null && 
                'id' in item && 
                'imageUrl' in item && 
                'title' in item
              ) {
                parsedBanners.push({
                  id: String(item.id),
                  imageUrl: String(item.imageUrl),
                  title: String(item.title),
                  description: 'description' in item ? String(item.description) : undefined,
                  link: 'link' in item ? String(item.link) : undefined
                });
              }
            }
            
            if (!cancelled) setBanners(parsedBanners);
          } else {
            if (!cancelled) setBanners([]);
          }
        }
      } catch (error) {
        console.error('Error fetching banners:', error);
        if (!cancelled) setBanners([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    
    fetchBanners();

    return () => {
      cancelled = true;
    };
  }, [restaurantId, userId, variant]);
  
  const clickables = useMemo(() => {
    return banners.filter((b) => String(b.imageUrl || b.externalVideoUrl || b.link || '').trim());
  }, [banners]);
  
  useEffect(() => {
    if (!autoPlay || clickables.length <= 1) return;
    
    const timer = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % clickables.length);
    }, interval);
    
    return () => clearInterval(timer);
  }, [autoPlay, interval, clickables.length]);
  
  if (isLoading) {
    return (
      <div className="w-full h-28 bg-gray-200 animate-pulse rounded-lg flex items-center justify-center">
        <span className="text-xs text-gray-400">Carregando banners...</span>
      </div>
    );
  }
  
  if (clickables.length === 0) {
    if (variant === 'wide' && fallbackImage) {
      return (
        <div className="relative h-[180px] w-full overflow-hidden rounded-[22px] border border-white/80 bg-slate-100 shadow-[0_20px_48px_-28px_rgba(15,23,42,0.55)] sm:h-[270px] sm:rounded-[28px] lg:h-[330px]">
          <img src={fallbackImage} alt="Oferta em destaque" className="h-full w-full object-cover" loading="eager" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-transparent" />
        </div>
      );
    }
    return null;
  }
  
  const handlePrevious = () => {
    setCurrentIndex((prevIndex) => (prevIndex - 1 + clickables.length) % clickables.length);
  };
  
  const handleNext = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % clickables.length);
  };
  
  if (variant === 'tile') {
    return (
      <>
        <div className="w-full">
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {clickables.map((b, index) => {
              const thumbnailUrl = getBannerThumbnail(b);

              return (
            <button
              key={b.id}
              type="button"
              onClick={() => handleBannerClick(index)}
              className="group block w-full overflow-hidden rounded-[22px] border border-white/80 bg-white shadow-[0_16px_36px_-22px_rgba(15,23,42,0.55)] transition-all duration-300 hover:-translate-y-1"
            >
              <div className="relative aspect-[2/3] w-full bg-gray-100">
                {b.mediaSource === 'instagram' ? (
                  <div className="absolute inset-0 bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#FCAF45] text-white">
                    {thumbnailUrl ? (
                      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${thumbnailUrl})` }} />
                    ) : null}
                    <div className="absolute inset-0 bg-black/15" />
                    <div className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#E1306C] shadow-sm">
                      <Instagram className="h-4 w-4" />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white shadow-lg">
                        <Play className="ml-0.5 h-5 w-5 fill-current" />
                      </span>
                    </div>
                  </div>
                ) : isVideoAsset(b.imageUrl) ? (
                  <AutoplayVideo
                    src={b.imageUrl}
                    className="absolute inset-0 h-full w-full object-cover"
                    loop
                  />
                ) : (
                  <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${b.imageUrl})` }} />
                )}
              </div>
            </button>
              );
            })}
          </div>
        </div>
        <BannerStoryViewer
          open={storyOpen}
          banners={clickables}
          initialIndex={storyIndex}
          linkedProducts={linkedProducts}
          onClose={() => setStoryOpen(false)}
          onOpenProduct={onSelectProductId}
          onQuickAddProduct={onQuickAddProduct}
          onOpenLink={openLink}
        />
      </>
    );
  }

  return (
    <>
      <div className="relative h-[180px] w-full overflow-hidden rounded-[22px] border border-white/80 bg-slate-100 shadow-[0_20px_48px_-28px_rgba(15,23,42,0.55)] sm:h-[270px] sm:rounded-[28px] lg:h-[330px]">
        <div
          className="flex h-full w-full transition-transform duration-700 ease-in-out"
          style={{ transform: `translateX(-${(currentIndex % clickables.length) * 100}%)` }}
        >
          {clickables.map((banner, index) => {
            const thumbnailUrl = getBannerThumbnail(banner);

            return (
              <button
                key={banner.id}
                type="button"
                className="relative block h-full min-w-full"
                onClick={() => handleBannerClick(index)}
                aria-label={`Banner promocional ${banner.title?.trim() || 'Instagram'}`}
              >
                {banner.mediaSource === 'instagram' ? (
                  <div className="absolute inset-0 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#FCAF45] text-white">
                    {thumbnailUrl ? (
                      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${thumbnailUrl})` }} />
                    ) : null}
                    <div className="absolute inset-0 bg-black/20" />
                    <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-[#E1306C] shadow-sm">
                      <Instagram className="h-3.5 w-3.5" />
                      Instagram
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white shadow-lg">
                        <Play className="ml-0.5 h-5 w-5 fill-current" />
                      </span>
                    </div>
                  </div>
                ) : isVideoAsset(banner.imageUrl) ? (
                  <AutoplayVideo
                    src={banner.imageUrl}
                    className="absolute inset-0 h-full w-full object-cover"
                    loop
                  />
                ) : (
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${banner.imageUrl})` }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {clickables.length > 1 ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-black/30 text-white hover:bg-black/50 hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                handlePrevious();
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-black/30 text-white hover:bg-black/50 hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        ) : null}

        {clickables.length > 1 ? (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center space-x-1">
            {clickables.map((_, index) => (
              <button
                key={index}
                className={`h-1.5 rounded-full transition-all ${currentIndex === index ? 'w-5 bg-white' : 'w-1.5 bg-white/50'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(index);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <BannerStoryViewer
        open={storyOpen}
        banners={clickables}
        initialIndex={storyIndex}
        linkedProducts={linkedProducts}
        onClose={() => setStoryOpen(false)}
        onOpenProduct={onSelectProductId}
        onQuickAddProduct={onQuickAddProduct}
        onOpenLink={openLink}
      />
    </>
  );
};

export default PromotionalBanner;
