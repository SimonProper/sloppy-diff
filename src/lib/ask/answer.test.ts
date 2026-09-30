import { expect, test } from 'vitest';
import { straightAnswer } from './answer';

test('straightAnswer is what comes before the first rule or paragraph break', () => {
	expect(straightAnswer('Yes, it retries.\n---\nBecause `x`.\n\nMore.')).toBe('Yes, it retries.');
	expect(straightAnswer('No.\n\nThe loop exits early.\n---\nMore.')).toBe('No.');
	expect(straightAnswer('  Just this.  ')).toBe('Just this.');
});
