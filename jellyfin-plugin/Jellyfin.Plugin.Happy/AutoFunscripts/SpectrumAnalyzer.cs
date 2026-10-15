using System;
using System.Collections.Generic;

namespace Jellyfin.Plugin.Happy.AutoFunscripts;

/// <summary>
/// Turns mono PCM into funscript actions that follow the power of one frequency band.
/// </summary>
/// <remarks>
/// A Hann-windowed short-time FFT (about 4 Hz resolution) measures every bin of the band once per frame.
/// Each bin is scaled to its own loudest moment in the file, so a band where a few bins dominate still
/// moves; bins that never rise above <see cref="NoiseFloorDbfs"/> are ignored so scaling cannot amplify
/// noise. The per-frame mean of the scaled bins is scaled once more so the loudest moment reaches 100,
/// cut to 0 below <see cref="AutoFunscriptSettings.MinPower"/>, and thinned to changes of at least
/// <see cref="AutoFunscriptSettings.MinPositionDelta"/> while keeping every turning point.
/// Feed samples with <see cref="Push"/>, then call <see cref="Finish"/> once.
/// </remarks>
public sealed class SpectrumAnalyzer
{
    /// <summary>
    /// Bins whose loudest moment stays below this level (dB full scale) count as silent.
    /// </summary>
    internal const double NoiseFloorDbfs = -60;

    private readonly AutoFunscriptSettings _settings;
    private readonly int _sampleRate;
    private readonly int _fftSize;
    private readonly int _hop;
    private readonly int _loBin;
    private readonly int _bins;
    private readonly double[] _window;
    private readonly double[] _re;
    private readonly double[] _im;
    private readonly int[] _reverse;
    private readonly double[] _cos;
    private readonly double[] _sin;
    private readonly float[] _binMax;
    private readonly List<float[]> _frames = [];
    private float[] _pending;
    private int _pendingLength;
    private int _skip;

    /// <summary>
    /// Initializes a new instance of the <see cref="SpectrumAnalyzer"/> class.
    /// </summary>
    /// <param name="sampleRate">Sample rate of the pushed PCM in Hz.</param>
    /// <param name="settings">The analysis settings.</param>
    public SpectrumAnalyzer(int sampleRate, AutoFunscriptSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentOutOfRangeException.ThrowIfLessThan(sampleRate, 8);
        _settings = settings;
        _sampleRate = sampleRate;
        _fftSize = 1 << (int)Math.Ceiling(Math.Log2(sampleRate / 4.0));
        _hop = Math.Max(1, (int)Math.Round(sampleRate * settings.FrameMs / 1000.0));

        var nyquistBin = _fftSize / 2;
        _loBin = Math.Min(nyquistBin, Math.Max(1, (int)Math.Ceiling((double)settings.MinFrequency * _fftSize / sampleRate)));
        var hiBin = Math.Min(nyquistBin, Math.Max(_loBin, (int)Math.Floor((double)settings.MaxFrequency * _fftSize / sampleRate)));
        _bins = hiBin - _loBin + 1;

        _window = new double[_fftSize];
        for (var i = 0; i < _fftSize; i++)
        {
            _window[i] = 0.5 * (1 - Math.Cos(2 * Math.PI * i / (_fftSize - 1)));
        }

        var levels = (int)Math.Log2(_fftSize);
        _reverse = new int[_fftSize];
        for (var i = 0; i < _fftSize; i++)
        {
            var r = 0;
            for (var b = 0; b < levels; b++)
            {
                r |= ((i >> b) & 1) << (levels - 1 - b);
            }

            _reverse[i] = r;
        }

        _cos = new double[_fftSize / 2];
        _sin = new double[_fftSize / 2];
        for (var i = 0; i < _fftSize / 2; i++)
        {
            _cos[i] = Math.Cos(2 * Math.PI * i / _fftSize);
            _sin[i] = -Math.Sin(2 * Math.PI * i / _fftSize);
        }

        _re = new double[_fftSize];
        _im = new double[_fftSize];
        _binMax = new float[_bins];
        _pending = new float[_fftSize * 4];
    }

    /// <summary>
    /// Analyses the next block of samples.
    /// </summary>
    /// <param name="samples">Mono samples, full scale ±1.</param>
    public void Push(ReadOnlySpan<float> samples)
    {
        if (_skip > 0)
        {
            var dropped = Math.Min(_skip, samples.Length);
            samples = samples[dropped..];
            _skip -= dropped;
        }

        if (_pendingLength + samples.Length > _pending.Length)
        {
            Array.Resize(ref _pending, Math.Max(_pending.Length * 2, _pendingLength + samples.Length));
        }

        samples.CopyTo(_pending.AsSpan(_pendingLength));
        _pendingLength += samples.Length;

        var offset = 0;
        while (_pendingLength - offset >= _fftSize)
        {
            AnalyseFrame(offset);
            offset += _hop;
        }

        if (offset > 0)
        {
            // The hop may step past the buffered samples; the rest is skipped from the next block.
            var consumed = Math.Min(offset, _pendingLength);
            _skip = offset - consumed;
            Array.Copy(_pending, consumed, _pending, 0, _pendingLength - consumed);
            _pendingLength -= consumed;
        }
    }

    /// <summary>
    /// Normalises the analysed frames and builds the funscript actions.
    /// </summary>
    /// <returns>Actions sorted by time; empty when the input was shorter than one FFT window.</returns>
    public IReadOnlyList<AutoFunscriptAction> Finish()
    {
        var frameCount = _frames.Count;

        // A full-scale sine under a Hann window peaks at fftSize / 4.
        var floor = _fftSize / 4.0 * Math.Pow(10, NoiseFloorDbfs / 20);
        var raw = new double[frameCount];
        var peak = 0.0;
        for (var f = 0; f < frameCount; f++)
        {
            var frame = _frames[f];
            var sum = 0.0;
            var counted = 0;
            for (var b = 0; b < _bins; b++)
            {
                if (_binMax[b] <= floor)
                {
                    continue;
                }

                sum += frame[b] / _binMax[b];
                counted++;
            }

            raw[f] = counted > 0 ? sum / counted : 0;
            peak = Math.Max(peak, raw[f]);
        }

        // Bins rarely peak together, so the band mean is rescaled once more to let the loudest moment reach 100.
        var positions = new int[frameCount];
        for (var f = 0; f < frameCount; f++)
        {
            var value = peak > 0 ? raw[f] / peak : 0;
            positions[f] = value < _settings.MinPower ? 0 : (int)Math.Round(value * 100);
        }

        var centerMs = _fftSize / 2.0 / _sampleRate * 1000;
        var minDelta = Math.Max(1, _settings.MinPositionDelta);
        var actions = new List<AutoFunscriptAction>();
        var last = int.MinValue;
        for (var f = 0; f < frameCount; f++)
        {
            var pos = positions[f];
            var prev = f > 0 ? positions[f - 1] : pos;
            var next = f < frameCount - 1 ? positions[f + 1] : pos;
            var isTurningPoint = (pos > prev && pos >= next) || (pos < prev && pos <= next);

            // Turning points and the end are kept regardless of the delta so peaks are not flattened.
            if (actions.Count == 0
                || Math.Abs(pos - last) >= minDelta
                || ((isTurningPoint || f == frameCount - 1) && pos != last))
            {
                actions.Add(new AutoFunscriptAction((long)Math.Round((f * (double)_settings.FrameMs) + centerMs), pos));
                last = pos;
            }
        }

        return actions;
    }

    private void AnalyseFrame(int offset)
    {
        for (var i = 0; i < _fftSize; i++)
        {
            _re[i] = _pending[offset + i] * _window[i];
            _im[i] = 0;
        }

        Fft();
        var frame = new float[_bins];
        for (var b = 0; b < _bins; b++)
        {
            var k = _loBin + b;
            var magnitude = (float)Math.Sqrt((_re[k] * _re[k]) + (_im[k] * _im[k]));
            frame[b] = magnitude;
            _binMax[b] = Math.Max(_binMax[b], magnitude);
        }

        _frames.Add(frame);
    }

    /// <summary>
    /// In-place iterative radix-2 FFT of <see cref="_re"/> and <see cref="_im"/>.
    /// </summary>
    private void Fft()
    {
        for (var i = 0; i < _fftSize; i++)
        {
            var j = _reverse[i];
            if (j > i)
            {
                (_re[i], _re[j]) = (_re[j], _re[i]);
                (_im[i], _im[j]) = (_im[j], _im[i]);
            }
        }

        for (var len = 2; len <= _fftSize; len <<= 1)
        {
            var half = len >> 1;
            var step = _fftSize / len;
            for (var start = 0; start < _fftSize; start += len)
            {
                for (var k = 0; k < half; k++)
                {
                    var a = start + k;
                    var b = a + half;
                    var wr = _cos[k * step];
                    var wi = _sin[k * step];
                    var tr = (_re[b] * wr) - (_im[b] * wi);
                    var ti = (_re[b] * wi) + (_im[b] * wr);
                    _re[b] = _re[a] - tr;
                    _im[b] = _im[a] - ti;
                    _re[a] += tr;
                    _im[a] += ti;
                }
            }
        }
    }
}
