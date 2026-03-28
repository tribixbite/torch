import { memo } from 'react';

interface Props {
	col: number;
	row: number;
	spriteUrl: string;
	/** Direct image URL (used when sprite sheet is unavailable) */
	imageUrl?: string;
	size?: number;
}

export default memo(function SpriteImage({ col, row, spriteUrl, imageUrl, size = 100 }: Props) {
	const x = -col * size;
	const y = -row * size;
	const useSprite = spriteUrl && spriteUrl.length > 0;

	if (useSprite) {
		return (
			<div
				className="flex-shrink-0 rounded"
				style={{
					width: size,
					height: size,
					backgroundImage: `url('${spriteUrl}')`,
					backgroundPosition: `${x}px ${y}px`,
					backgroundRepeat: 'no-repeat',
				}}
			/>
		);
	}

	if (imageUrl) {
		return (
			<img
				src={imageUrl}
				alt=""
				loading="lazy"
				className="flex-shrink-0 rounded object-contain"
				style={{ width: size, height: size, background: 'var(--bg-tertiary)' }}
			/>
		);
	}

	return (
		<div
			className="flex-shrink-0 rounded flex items-center justify-center text-xs"
			style={{ width: size, height: size, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
		>
			no img
		</div>
	);
});
