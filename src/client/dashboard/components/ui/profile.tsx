import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../utils/cn';
import { Avatar, type AvatarColor } from './avatar';
import { Icon } from './icon';

export interface ProfileAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}

export const ProfileAvatar = React.forwardRef<
  HTMLDivElement,
  ProfileAvatarProps
>(({ className, asChild = false, children, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp ref={ref} className={cn('shrink-0', className)} {...props}>
      {children}
    </Comp>
  );
});
ProfileAvatar.displayName = 'ProfileAvatar';

export interface ProfileProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'name'> {
  /**
   * User's name to display next to the avatar.
   */
  name?: React.ReactNode;
  /**
   * URL to the image to display as avatar, or custom ReactNode.
   */
  avatar?: React.ReactNode;
  /**
   * Name to use for avatar initial generation.
   */
  avatarName?: string;
  'avatar:name'?: string;
  /**
   * Color to use for the avatar.
   */
  avatarColor?: AvatarColor;
  'avatar:color'?: AvatarColor;
  /**
   * Whether to display a circular avatar. Default: false.
   */
  circle?: boolean;
  /**
   * Custom initials to display when no avatar image is provided. Automatically generated from name if not provided.
   */
  initials?: string;
  /**
   * Whether to display a chevron icon (dropdown indicator). Default: true.
   */
  chevron?: boolean;
  /**
   * Custom icon to display instead of the chevron. Accepts any icon name or ReactNode.
   */
  iconTrailing?: string | React.ReactNode;
  'icon:trailing'?: string | React.ReactNode;
  /**
   * Icon variant to use for the trailing icon. Options: 'micro' (default), 'outline'.
   */
  iconVariant?: 'micro' | 'outline';
  'icon:variant'?: 'micro' | 'outline';
  /**
   * Change the default rendered element for the one passed as a child, merging their props and behavior.
   */
  asChild?: boolean;
}

const ProfileRoot = React.forwardRef<HTMLButtonElement, ProfileProps>(
  (
    {
      name,
      avatar,
      avatarName,
      'avatar:name': avatarNameProp,
      avatarColor,
      'avatar:color': avatarColorProp,
      circle = false,
      initials,
      chevron = true,
      iconTrailing,
      'icon:trailing': iconTrailingProp,
      iconVariant = 'micro',
      'icon:variant': iconVariantProp,
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const activeAvatarName = avatarNameProp ?? avatarName;
    const activeAvatarColor = avatarColorProp ?? avatarColor;
    const activeIconTrailing = iconTrailingProp ?? iconTrailing;
    const activeIconVariant = iconVariantProp ?? iconVariant;

    const Comp = asChild ? Slot : 'button';

    const renderAvatar = () => {
      if (React.isValidElement(avatar)) {
        return <ProfileAvatar>{avatar}</ProfileAvatar>;
      }

      return (
        <ProfileAvatar>
          <Avatar
            src={typeof avatar === 'string' ? avatar : undefined}
            name={
              activeAvatarName ?? (typeof name === 'string' ? name : undefined)
            }
            initials={initials}
            color={activeAvatarColor}
            circle={circle}
            size="sm"
          />
        </ProfileAvatar>
      );
    };

    const renderTrailingIcon = () => {
      if (!chevron && !activeIconTrailing) return null;

      let iconContent: React.ReactNode;
      if (activeIconTrailing) {
        if (typeof activeIconTrailing === 'string') {
          iconContent = (
            <Icon
              name={activeIconTrailing}
              size={16}
              variant={activeIconVariant === 'outline' ? 'outline' : 'solid'}
              className="shrink-0 size-4 text-zinc-400 dark:text-white/80 group-hover:text-zinc-800 dark:group-hover:text-white transition-colors"
            />
          );
        } else {
          iconContent = activeIconTrailing;
        }
      } else {
        iconContent = (
          <svg
            className="shrink-0 size-4 text-zinc-400 dark:text-white/80 group-hover:text-zinc-800 dark:group-hover:text-white transition-colors"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
            data-slot="icon"
          >
            <path
              fillRule="evenodd"
              d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        );
      }

      return (
        <div className="shrink-0 ms-auto size-8 flex justify-center items-center">
          {iconContent}
        </div>
      );
    };

    return (
      <Comp
        ref={ref}
        type={!asChild ? 'button' : undefined}
        data-circle={circle ? 'true' : undefined}
        className={cn(
          'group flex items-center rounded-lg has-data-[circle=true]:rounded-full [ui-dropdown>&]:w-full p-1 hover:bg-[var(--color-secondary,rgba(0,0,0,0.05))] dark:hover:bg-white/15 select-none text-start transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          circle && 'rounded-full',
          className
        )}
        {...props}
      >
        {renderAvatar()}
        {children}
        {name && (
          <span className="mx-2 text-sm text-[var(--text-muted,var(--color-text-muted,#71717a))] group-hover:text-[var(--text-primary,var(--color-text,#18181b))] dark:text-white/80 dark:group-hover:text-white font-medium truncate">
            {name}
          </span>
        )}
        {renderTrailingIcon()}
      </Comp>
    );
  }
);
ProfileRoot.displayName = 'Profile';

export const Profile = Object.assign(ProfileRoot, {
  Avatar: ProfileAvatar,
});
