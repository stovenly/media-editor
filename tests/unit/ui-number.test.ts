import { describe, expect, it } from 'vitest';
import {
  formatTime,
  formatValue,
  parseNumber,
  parseTime,
  snapToStep,
} from '../../src/app/ui/number';

describe('formatTime', () => {
  it('shows minutes, seconds and hundredths', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(2)).toBe('0:02.00');
    expect(formatTime(75.5)).toBe('1:15.50');
    expect(formatTime(599.99)).toBe('9:59.99');
  });

  it('adds hours from an hour on', () => {
    expect(formatTime(3600)).toBe('1:00:00.00');
    expect(formatTime(3725.25)).toBe('1:02:05.25');
  });

  it('rounds to hundredths without showing 60 seconds', () => {
    expect(formatTime(59.999)).toBe('1:00.00');
  });

  it('treats negative time as zero', () => {
    expect(formatTime(-3)).toBe('0:00.00');
  });
});

describe('parseTime', () => {
  it('accepts plain seconds', () => {
    expect(parseTime('12')).toBe(12);
    expect(parseTime('2.5')).toBe(2.5);
    expect(parseTime('.5')).toBe(0.5);
    expect(parseTime(' 90 ')).toBe(90);
    expect(parseTime('3s')).toBe(3);
    expect(parseTime('1,25')).toBe(1.25);
  });

  it('accepts m:ss.ff and h:mm:ss.ff', () => {
    expect(parseTime('1:15.50')).toBe(75.5);
    expect(parseTime('0:02')).toBe(2);
    expect(parseTime('1:02:05.25')).toBeCloseTo(3725.25);
  });

  it('reads back what formatTime writes', () => {
    for (const t of [0, 0.05, 2, 61.37, 3599.99, 7322.5]) expect(parseTime(formatTime(t))).toBe(t);
  });

  it('rejects anything else', () => {
    for (const text of ['', 'abc', '1:2:3:4', '1:60', '1:60:00', '-2', '1:-5', '1.5:00', ':30'])
      expect(parseTime(text)).toBeNull();
  });
});

describe('parseNumber', () => {
  it('reads numbers with an optional unit and either minus sign', () => {
    expect(parseNumber('−3.5 dB', 'dB')).toBe(-3.5);
    expect(parseNumber('+2', 'dB')).toBe(2);
    expect(parseNumber('40%', '%')).toBe(40);
    expect(parseNumber('1.25×', '×')).toBe(1.25);
    expect(parseNumber('x')).toBeNull();
  });
});

describe('formatValue', () => {
  it('shows the unit and a true minus sign', () => {
    expect(formatValue(-3.5, 1, 'dB')).toBe('−3.5 dB');
    expect(formatValue(3, 1, 'dB', true)).toBe('+3.0 dB');
    expect(formatValue(-0.01, 1, 'dB', true)).toBe('0.0 dB');
    expect(formatValue(1.25, 2, '×')).toBe('1.25×');
    expect(formatValue(40, 0, '%')).toBe('40%');
  });
});

describe('snapToStep', () => {
  it('snaps onto the min + n·step grid without passing its last point', () => {
    expect(snapToStep(-1.94, -30, 12, 0.5)).toBe(-2);
    expect(snapToStep(1.37, 0.25, 4, 0.05)).toBe(1.35);
    expect(snapToStep(1.2345, 0, 1.2345, 0.1)).toBe(1.2);
    expect(snapToStep(99, 0, 100, 5)).toBe(100);
  });
});
