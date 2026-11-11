import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';

// ── Registry for External Controls ──────────────────────────────────────────

export interface CarouselInstance {
  prev: () => void;
  next: () => void;
  goTo: (index: number) => void;
  getState: () => CarouselState;
  subscribe: (listener: () => void) => () => void;
}

export interface CarouselState {
  activeIndex: number;
  totalSlides: number;
  canScrollPrev: boolean;
  canScrollNext: boolean;
  disabled: boolean;
}

class CarouselRegistry {
  private instances = new Map<string, CarouselInstance>();
  private listeners = new Map<string, Set<() => void>>();

  register(name: string, instance: CarouselInstance) {
    this.instances.set(name, instance);
    this.notify(name);
    return () => {
      this.instances.delete(name);
      this.notify(name);
    };
  }

  get(name: string): CarouselInstance | undefined {
    return this.instances.get(name);
  }

  subscribe(name: string, listener: () => void): () => void {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }
    this.listeners.get(name)!.add(listener);

    return () => {
      const set = this.listeners.get(name);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(name);
        }
      }
    };
  }

  private notify(name: string) {
    const set = this.listeners.get(name);
    if (set) {
      set.forEach((fn) => fn());
    }
  }
}

export const carouselRegistry = new CarouselRegistry();

// ── Context ─────────────────────────────────────────────────────────────────

interface CarouselContextValue extends CarouselState {
  name?: string | undefined;
  prev: () => void;
  next: () => void;
  goTo: (index: number) => void;
}

const CarouselContext = createContext<CarouselContextValue | null>(null);

export function useCarouselContext() {
  return useContext(CarouselContext);
}

// ── Main Carousel Component ─────────────────────────────────────────────────

export interface CarouselProps extends React.HTMLAttributes<HTMLDivElement> {
  /** If true, shows previous and next arrow controls over the carousel. Default: true. */
  arrows?: boolean;
  /** Position for the built-in arrow controls. Options: inside, overlap, outside. Default: inside. */
  arrowsPosition?: 'inside' | 'overlap' | 'outside';
  /** Alternative prop name for arrows:position */
  'arrows:position'?: 'inside' | 'overlap' | 'outside';
  /** If true, automatically advances slides. Pauses on hover, focus, or interaction. */
  autoplay?: boolean;
  /** Time between autoplay advances in milliseconds. Default: 5000. */
  autoplayInterval?: number;
  /** Alternative prop name for autoplay:interval */
  'autoplay:interval'?: number;
  /** If true, shows slide indicators below the carousel. Default: false. */
  indicators?: boolean;
  /** If true, disables carousel controls and indicators. Default: false. */
  disabled?: boolean;
  /** If true, fades the scrollable track edges when additional slides are overflowed. Default: false. */
  fade?: boolean;
  /** Extends carousel through horizontal padding while keeping slides aligned to content gutter. Default: 1.5rem */
  bleed?: boolean | string | number;
  /** Scroll snap behavior. Options: proximity, mandatory. Default: proximity. */
  snap?: 'proximity' | 'mandatory';
  /** Arrow and indicator scroll behavior. Options: smooth, instant. Default: smooth. */
  scroll?: 'smooth' | 'instant';
  /** How many slides arrow controls move. Options: slide, page. Default: slide. */
  advance?: 'slide' | 'page';
  /** What happens when advancing past the final slide. Options: none, rewind. Default: none. */
  wrap?: 'none' | 'rewind';
  /** Unique name used to connect the carousel with external controls. */
  name?: string;
}

export function Carousel({
  children,
  arrows = true,
  arrowsPosition: arrowsPositionProp,
  'arrows:position': arrowsPositionColon,
  autoplay = false,
  autoplayInterval: autoplayIntervalProp,
  'autoplay:interval': autoplayIntervalColon,
  indicators = false,
  disabled = false,
  fade = false,
  bleed = false,
  snap = 'proximity',
  scroll = 'smooth',
  advance = 'slide',
  wrap = 'none',
  name,
  className,
  style,
  ...props
}: CarouselProps) {
  const arrowsPosition = arrowsPositionProp ?? arrowsPositionColon ?? 'inside';
  const autoplayInterval =
    autoplayIntervalProp ?? autoplayIntervalColon ?? 5000;

  const trackRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isHoveredRef = useRef(false);
  const isInteractingRef = useRef(false);
  const stateSubscribersRef = useRef<Set<() => void>>(new Set());

  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [slideCount, setSlideCount] = useState(0);

  // Compute bleed value
  const bleedStyleValue = useMemo(() => {
    if (!bleed) return undefined;
    if (typeof bleed === 'string') return bleed;
    if (typeof bleed === 'number') return `${bleed}px`;
    return 'var(--carousel-bleed, 1.5rem)';
  }, [bleed]);

  // Update navigation state
  const updateScrollState = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;

    const { scrollLeft, scrollWidth, clientWidth } = track;
    const maxScroll = Math.max(0, scrollWidth - clientWidth);
    const tolerance = 4; // px tolerance for fractional subpixel scrolling

    const hasPrev = scrollLeft > tolerance;
    const hasNext = scrollLeft < maxScroll - tolerance;

    setCanScrollPrev(wrap === 'rewind' ? true : hasPrev);
    setCanScrollNext(wrap === 'rewind' ? true : hasNext);

    // Calculate active slide index based on scroll position
    const slides = Array.from(track.children) as HTMLElement[];
    setSlideCount(slides.length);

    if (slides.length > 0) {
      let closestIdx = 0;
      let minDistance = Infinity;

      slides.forEach((slide, idx) => {
        const distance = Math.abs(
          slide.offsetLeft - track.offsetLeft - scrollLeft
        );
        if (distance < minDistance) {
          minDistance = distance;
          closestIdx = idx;
        }
      });
      setActiveIndex(closestIdx);
    }

    stateSubscribersRef.current.forEach((fn) => fn());
  }, [wrap]);

  // Navigate to previous slide or page
  const prev = useCallback(() => {
    if (disabled) return;
    const track = trackRef.current;
    if (!track) return;

    const behavior: ScrollBehavior =
      scroll === 'instant' ? 'instant' : 'smooth';
    const tolerance = 4;
    const isAtStart = track.scrollLeft <= tolerance;

    if (isAtStart && wrap === 'rewind') {
      track.scrollTo({ left: track.scrollWidth, behavior });
      return;
    }

    if (advance === 'page') {
      track.scrollBy({ left: -track.clientWidth, behavior });
    } else {
      const slides = Array.from(track.children) as HTMLElement[];
      const trackOffsetLeft = track.offsetLeft;
      let targetLeft = 0;

      for (let i = slides.length - 1; i >= 0; i--) {
        const slide = slides[i];
        if (!slide) continue;
        const slideLeft = slide.offsetLeft - trackOffsetLeft;
        if (slideLeft < track.scrollLeft - tolerance) {
          targetLeft = slideLeft;
          break;
        }
      }
      track.scrollTo({ left: Math.max(0, targetLeft), behavior });
    }
  }, [disabled, scroll, wrap, advance]);

  // Navigate to next slide or page
  const next = useCallback(() => {
    if (disabled) return;
    const track = trackRef.current;
    if (!track) return;

    const behavior: ScrollBehavior =
      scroll === 'instant' ? 'instant' : 'smooth';
    const maxScroll = track.scrollWidth - track.clientWidth;
    const tolerance = 4;
    const isAtEnd = track.scrollLeft >= maxScroll - tolerance;

    if (isAtEnd && wrap === 'rewind') {
      track.scrollTo({ left: 0, behavior });
      return;
    }

    if (advance === 'page') {
      track.scrollBy({ left: track.clientWidth, behavior });
    } else {
      const slides = Array.from(track.children) as HTMLElement[];
      const trackOffsetLeft = track.offsetLeft;
      let targetLeft = maxScroll;

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        if (!slide) continue;
        const slideLeft = slide.offsetLeft - trackOffsetLeft;
        if (slideLeft > track.scrollLeft + tolerance) {
          targetLeft = slideLeft;
          break;
        }
      }
      track.scrollTo({ left: Math.min(maxScroll, targetLeft), behavior });
    }
  }, [disabled, scroll, wrap, advance]);

  // Navigate to specific slide index
  const goTo = useCallback(
    (index: number) => {
      if (disabled) return;
      const track = trackRef.current;
      if (!track) return;

      const slides = Array.from(track.children) as HTMLElement[];
      if (slides[index]) {
        const behavior: ScrollBehavior =
          scroll === 'instant' ? 'instant' : 'smooth';
        const slideLeft = slides[index].offsetLeft - track.offsetLeft;
        track.scrollTo({ left: slideLeft, behavior });
      }
    },
    [disabled, scroll]
  );

  // Monitor track scroll and resize
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    updateScrollState();

    const handleScroll = () => {
      updateScrollState();
    };

    track.addEventListener('scroll', handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });
    resizeObserver.observe(track);
    Array.from(track.children).forEach((child) =>
      resizeObserver.observe(child)
    );

    return () => {
      track.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, [updateScrollState]);

  // Autoplay functionality
  useEffect(() => {
    if (!autoplay || disabled) return;

    // Check prefers-reduced-motion
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const interval = setInterval(() => {
      if (isHoveredRef.current || isInteractingRef.current) return;
      const track = trackRef.current;
      if (!track) return;

      const maxScroll = track.scrollWidth - track.clientWidth;
      const tolerance = 4;
      const isAtEnd = track.scrollLeft >= maxScroll - tolerance;

      if (isAtEnd) {
        if (wrap === 'rewind') {
          track.scrollTo({
            left: 0,
            behavior: scroll === 'instant' ? 'instant' : 'smooth',
          });
        }
      } else {
        next();
      }
    }, autoplayInterval);

    return () => clearInterval(interval);
  }, [autoplay, autoplayInterval, disabled, next, scroll, wrap]);

  // Register in global carousel registry if name is provided
  useEffect(() => {
    if (!name) return;

    const instance: CarouselInstance = {
      prev,
      next,
      goTo,
      getState: () => ({
        activeIndex,
        totalSlides: slideCount,
        canScrollPrev,
        canScrollNext,
        disabled,
      }),
      subscribe: (listener: () => void) => {
        stateSubscribersRef.current.add(listener);
        return () => {
          stateSubscribersRef.current.delete(listener);
        };
      },
    };

    const unregister = carouselRegistry.register(name, instance);
    return unregister;
  }, [
    name,
    prev,
    next,
    goTo,
    activeIndex,
    slideCount,
    canScrollPrev,
    canScrollNext,
    disabled,
  ]);

  // Context value for nested subcomponents
  const contextValue = useMemo<CarouselContextValue>(
    () => ({
      name,
      activeIndex,
      totalSlides: slideCount,
      canScrollPrev,
      canScrollNext,
      disabled,
      prev,
      next,
      goTo,
    }),
    [
      name,
      activeIndex,
      slideCount,
      canScrollPrev,
      canScrollNext,
      disabled,
      prev,
      next,
      goTo,
    ]
  );

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      next();
    }
  };

  // Interaction handlers for pausing autoplay
  const handleMouseEnter = () => {
    isHoveredRef.current = true;
  };
  const handleMouseLeave = () => {
    isHoveredRef.current = false;
  };
  const handleFocus = () => {
    isHoveredRef.current = true;
  };
  const handleBlur = () => {
    isHoveredRef.current = false;
  };
  const handlePointerDown = () => {
    isInteractingRef.current = true;
  };
  const handlePointerUp = () => {
    setTimeout(() => {
      isInteractingRef.current = false;
    }, 1000);
  };

  const showLeftArrow = arrows && arrowsPosition !== 'outside';
  const showRightArrow = arrows && arrowsPosition !== 'outside';
  const showOutsideArrows = arrows && arrowsPosition === 'outside';

  return (
    <CarouselContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        role="region"
        aria-roledescription="carousel"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className={cn(
          'relative w-full focus-visible:outline-none',
          disabled && 'opacity-70 pointer-events-none',
          className
        )}
        style={
          {
            ...(bleedStyleValue ? { '--carousel-bleed': bleedStyleValue } : {}),
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        <div
          className={cn(
            'relative flex items-center',
            showOutsideArrows && 'gap-2'
          )}
        >
          {/* Outside Left Arrow */}
          {showOutsideArrows && (
            <CarouselArrowButton
              direction="prev"
              onClick={prev}
              disabled={disabled || (!canScrollPrev && wrap !== 'rewind')}
              className="relative shrink-0"
            />
          )}

          {/* Viewport & Track Wrapper */}
          <div
            className={cn(
              'relative flex-1 min-w-0 overflow-hidden',
              bleed && '-mx-[var(--carousel-bleed)]'
            )}
          >
            {/* Edge Fade: Left */}
            {fade && (
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-16 bg-gradient-to-r from-[var(--card-bg,hsl(var(--card)))] to-transparent transition-opacity duration-300',
                  canScrollPrev ? 'opacity-100' : 'opacity-0'
                )}
              />
            )}

            {/* Edge Fade: Right */}
            {fade && (
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-16 bg-gradient-to-l from-[var(--card-bg,hsl(var(--card)))] to-transparent transition-opacity duration-300',
                  canScrollNext ? 'opacity-100' : 'opacity-0'
                )}
              />
            )}

            {/* Built-in Arrows (inside or overlap) */}
            {showLeftArrow && (
              <CarouselArrowButton
                direction="prev"
                onClick={prev}
                disabled={disabled || (!canScrollPrev && wrap !== 'rewind')}
                position={arrowsPosition}
              />
            )}

            {showRightArrow && (
              <CarouselArrowButton
                direction="next"
                onClick={next}
                disabled={disabled || (!canScrollNext && wrap !== 'rewind')}
                position={arrowsPosition}
              />
            )}

            {/* Scrollable Track */}
            <div
              ref={trackRef}
              className={cn(
                'flex overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
                snap === 'mandatory'
                  ? 'snap-x snap-mandatory'
                  : 'snap-x snap-proximity',
                bleed &&
                  'px-[var(--carousel-bleed)] [scroll-padding-inline:var(--carousel-bleed)]'
              )}
            >
              {children}
            </div>
          </div>

          {/* Outside Right Arrow */}
          {showOutsideArrows && (
            <CarouselArrowButton
              direction="next"
              onClick={next}
              disabled={disabled || (!canScrollNext && wrap !== 'rewind')}
              className="relative shrink-0"
            />
          )}
        </div>

        {/* Slide Indicators */}
        {indicators && slideCount > 1 && (
          <div
            role="tablist"
            aria-label="Carousel slides"
            className="flex items-center justify-center gap-1.5 pt-3"
          >
            {Array.from({ length: slideCount }).map((_, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={activeIndex === index}
                aria-label={`Go to slide ${index + 1}`}
                disabled={disabled}
                onClick={() => goTo(index)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300 cursor-pointer disabled:pointer-events-none',
                  activeIndex === index
                    ? 'w-5 bg-foreground'
                    : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50'
                )}
              />
            ))}
          </div>
        )}
      </div>
    </CarouselContext.Provider>
  );
}

// ── Carousel Arrow Button ───────────────────────────────────────────────────

interface CarouselArrowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  direction: 'prev' | 'next';
  position?: 'inside' | 'overlap' | 'outside';
}

function CarouselArrowButton({
  direction,
  position = 'inside',
  disabled,
  className,
  ...props
}: CarouselArrowButtonProps) {
  const isPrev = direction === 'prev';
  const label = isPrev ? 'Previous slide' : 'Next slide';

  const positionClasses = useMemo(() => {
    if (position === 'overlap') {
      return isPrev
        ? 'absolute left-0 -translate-x-1/2 top-1/2 -translate-y-1/2 z-20'
        : 'absolute right-0 translate-x-1/2 top-1/2 -translate-y-1/2 z-20';
    }
    if (position === 'inside') {
      return isPrev
        ? 'absolute left-3 top-1/2 -translate-y-1/2 z-20'
        : 'absolute right-3 top-1/2 -translate-y-1/2 z-20';
    }
    return '';
  }, [position, isPrev]);

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900/80 text-white shadow-md border border-neutral-700/60 transition-all duration-200 backdrop-blur-sm hover:bg-neutral-800 active:scale-95 disabled:pointer-events-none disabled:opacity-30 cursor-pointer',
        positionClasses,
        className
      )}
      {...props}
    >
      {isPrev ? (
        <ChevronLeft className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
    </button>
  );
}

// ── Carousel Slide Subcomponent ─────────────────────────────────────────────

export interface CarouselSlideProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Classes applied to the slide. Use width classes like w-full, w-4/5, or md:w-1/3 */
  class?: string;
}

export function CarouselSlide({
  children,
  class: classProp,
  className,
  ...props
}: CarouselSlideProps) {
  return (
    <div
      role="group"
      aria-roledescription="slide"
      className={cn('shrink-0 snap-start', classProp, className)}
      {...props}
    >
      {children}
    </div>
  );
}

// ── Carousel Controls Subcomponent ──────────────────────────────────────────

export interface CarouselControlsRenderProps extends CarouselState {
  prev: () => void;
  next: () => void;
  goTo: (index: number) => void;
}

export interface CarouselControlsProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children'
> {
  /** Name of the carousel these external controls should operate on. */
  name?: string;
  children?:
    React.ReactNode | ((props: CarouselControlsRenderProps) => React.ReactNode);
}

export function CarouselControls({
  name,
  children,
  className,
  ...props
}: CarouselControlsProps) {
  const context = useCarouselContext();
  const [, setTick] = useState(0);

  // If connected via registry name
  const instance = name ? carouselRegistry.get(name) : undefined;

  useEffect(() => {
    if (!name) return;
    const unsubscribe = carouselRegistry.subscribe(name, () => {
      setTick((t) => t + 1);
    });
    return unsubscribe;
  }, [name]);

  const state = instance?.getState() ??
    context ?? {
      activeIndex: 0,
      totalSlides: 0,
      canScrollPrev: false,
      canScrollNext: false,
      disabled: false,
    };

  const prev = instance?.prev ?? context?.prev ?? (() => {});
  const next = instance?.next ?? context?.next ?? (() => {});
  const goTo = instance?.goTo ?? context?.goTo ?? (() => {});

  if (typeof children === 'function') {
    return (
      <div className={cn('flex items-center gap-2', className)} {...props}>
        {children({ ...state, prev, next, goTo })}
      </div>
    );
  }

  if (children) {
    return (
      <div className={cn('flex items-center gap-2', className)} {...props}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      <button
        type="button"
        aria-label="Previous slide"
        disabled={state.disabled || !state.canScrollPrev}
        onClick={prev}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900/80 text-white shadow-md border border-neutral-700/60 transition-all duration-200 backdrop-blur-sm hover:bg-neutral-800 active:scale-95 disabled:pointer-events-none disabled:opacity-30 cursor-pointer"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Next slide"
        disabled={state.disabled || !state.canScrollNext}
        onClick={next}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900/80 text-white shadow-md border border-neutral-700/60 transition-all duration-200 backdrop-blur-sm hover:bg-neutral-800 active:scale-95 disabled:pointer-events-none disabled:opacity-30 cursor-pointer"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Attach Compound Subcomponents ───────────────────────────────────────────

Carousel.Slide = CarouselSlide;
Carousel.Controls = CarouselControls;

export default Carousel;
