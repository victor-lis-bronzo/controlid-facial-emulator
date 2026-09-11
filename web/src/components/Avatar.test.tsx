import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar.tsx';

describe('Avatar', () => {
  it('renders the stored photo via user_get_image.fcgi when hasPhoto (Req 3.4)', () => {
    render(<Avatar userId={8} hasPhoto name="Walter White" />);

    const img = screen.getByRole('img', { name: /photo of walter white/i });
    expect(img).toHaveAttribute('src', expect.stringContaining('/user_get_image.fcgi?user_id=8'));
  });

  it('renders an initials placeholder when there is no photo', () => {
    render(<Avatar userId={6} hasPhoto={false} name="Neal Caffrey" />);

    // No <img> is rendered without a photo.
    expect(screen.queryByRole('img')).toBeNull();
    // Initials are derived from the first and last name.
    expect(screen.getByText('NC')).toBeInTheDocument();
  });
});
