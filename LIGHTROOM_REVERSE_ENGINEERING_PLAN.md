# Lightroom Reverse Engineering & Bug Fix Plan

## Executive Summary

This document outlines the comprehensive plan to reverse engineer Lightroom Classic and Lightroom CC features, identify bugs in the current develop/studio components, and implement missing functionality to make FOTO superior to both Adobe products.

## Current Status Analysis

### Existing Develop Component Features

**Implemented:**
- ✅ Basic adjustments (Temp/Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks)
- ✅ Presence controls (Texture, Clarity, Dehaze, Vibrance, Saturation)
- ✅ Tone Curve (Master + RGB channels, 2-16 points, Linear/Smooth interpolation)
- ✅ Color Mixer (8 HSL channels: Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta)
- ✅ Color Grading (Shadows/Midtones/Highlights/Global wheels, balance/blending)
- ✅ Effects (Grain, Halation, Bloom, Fade, Vignette, Film Falloff)
- ✅ Detail (Sharpening, Radius, Fine Detail, Edge Masking, Noise Reduction)
- ✅ Crop & Straighten (Aspect ratios, rotation, flips, auto-crop suggestion)
- ✅ Basic Masking (Linear/Radial gradients, up to 12 masks)
- ✅ Histogram (RGB + Luminance, clipping indicators)
- ✅ History/Snapshots (Undo/redo, before/after views)
- ✅ Presets (Built-in + custom, virtual copies)
- ✅ Export (JPEG/sRGB, quality control, size limits)

**Partially Implemented:**
- ⚠️ Masking (Only linear/radial, no brush/AI)
- ⚠️ Object Removal (Experimental, limited to 4K, macOS only)
- ⚠️ Reference Matching (Approximate, small-scale only)

**Missing Critical Features:**
- ❌ Brush/Eraser masking tools
- ❌ AI masking (Subject, Sky, People, Select Range)
- ❌ Parametric curves (Highlight/Shadows/Whites/Blacks regions)
- ❌ Point Color (Sampled color adjustment)
- ❌ Lens Correction (Profile, Manual, Upright)
- ❌ Perspective Transform (Upright, Manual perspective)
- ❌ Color Calibration (Camera profiles, Calibration panel)
- ❌ Soft Proofing (Print simulation, gamut warning)
- ❌ HDR Merge (Bracket processing)
- ❌ Panorama Merge (Stitching)
- ❌ Advanced Export (TIFF/PSD, batch queue, watermarks, output sharpening)
- ❌ Tethered Shooting
- ❌ Print Module
- ❌ Book Module
- ❌ Web Module
- ❌ Map Module
- ❌ Slideshow Module

## Lightroom Classic vs Lightroom CC Feature Matrix

| Feature Category | Lightroom Classic | Lightroom CC | FOTO Current | FOTO Target |
|-----------------|-------------------|--------------|--------------|-------------|
| **Storage & Sync** |
| Local File Storage | ✅ Full | ⚠️ Limited | ✅ Full | ✅ Superior |
| Cloud Sync | ⚠️ Smart Previews | ✅ Full | ❌ None | ✅ Hybrid |
| Offline Editing | ✅ Full | ⚠️ Synced only | ✅ Full | ✅ Full |
| Catalog System | ✅ Advanced | ❌ Albums only | ⚠️ Basic | ✅ Advanced |
| **Develop Module** |
| Basic Adjustments | ✅ Full | ✅ Full | ✅ Full | ✅ Enhanced |
| Tone Curve | ✅ Parametric + Point | ✅ Point only | ⚠️ Point only | ✅ Both |
| Color Mixer | ✅ HSL + Point Color | ✅ HSL only | ⚠️ HSL only | ✅ Both |
| Color Grading | ✅ Full | ✅ Full | ✅ Full | ✅ Enhanced |
| HSL / Color | ✅ Full | ✅ Full | ✅ Full | ✅ Enhanced |
| Masking | ✅ AI + Brush + Gradient | ✅ AI + Brush + Gradient | ⚠️ Gradient only | ✅ Superior AI |
| Lens Correction | ✅ Profile + Manual | ✅ Profile + Manual | ❌ None | ✅ Both |
| Perspective | ✅ Upright + Manual | ✅ Upright + Manual | ❌ None | ✅ Both |
| Calibration | ✅ Camera + Process | ❌ None | ❌ None | ✅ Both |
| Detail | ✅ AI Denoise + Manual | ✅ AI Denoise + Manual | ⚠️ Manual only | ✅ AI + Manual |
| Effects | ✅ Full | ✅ Full | ✅ Full | ✅ Enhanced |
| Crop/Rotate | ✅ Full | ✅ Full | ✅ Full | ✅ Enhanced |
| **Advanced Features** |
| HDR Merge | ✅ | ✅ | ❌ | ✅ |
| Panorama | ✅ | ✅ | ❌ | ✅ |
| Soft Proofing | ✅ | ❌ | ❌ | ✅ |
| Tethering | ✅ | ❌ | ❌ | ✅ |
| **Export Options** |
| JPEG Export | ✅ | ✅ | ✅ | ✅ Enhanced |
| TIFF/PSD Export | ✅ | ❌ | ❌ | ✅ |
| Batch Export | ✅ | ✅ | ❌ | ✅ |
| Watermarks | ✅ | ✅ | ❌ | ✅ |
| Output Sharpening | ✅ | ❌ | ❌ | ✅ |
| **Other Modules** |
| Print Module | ✅ | ❌ | ❌ | ✅ |
| Book Module | ✅ | ❌ | ❌ | ✅ |
| Web Module | ✅ | ❌ | ❌ | ✅ |
| Slideshow | ✅ | ❌ | ❌ | ✅ |
| Map Module | ✅ | ❌ | ❌ | ✅ |
| **AI Features** |
| AI Denoise | ✅ | ✅ | ❌ | ✅ |
| AI Masking | ✅ | ✅ | ❌ | ✅ |
| Generative Remove | ✅ | ✅ | ⚠️ Experimental | ✅ |
| Adaptive Presets | ✅ | ✅ | ❌ | ✅ |
| **Workflow** |
| Virtual Copies | ✅ | ❌ | ✅ | ✅ |
| Smart Collections | ✅ | ❌ | ❌ | ✅ |
| Stacking | ✅ | ❌ | ❌ | ✅ |
| Keywords | ✅ | ✅ | ❌ | ✅ |
| Face Recognition | ✅ | ⚠️ Cloud only | ⚠️ Basic | ✅ Enhanced |
| Plugin Support | ✅ 100+ | ❌ <5 | ❌ | ✅ API |

## Identified Bugs & Issues

### Critical Bugs

1. **White Balance Discontinuity** (contract.ts:35)
   - **Issue**: When usable camera WB is absent, zero Temp/Tint uses LibRaw's automatic fallback while nonzero adjustment switches to daylight baseline
   - **Impact**: Inconsistent WB behavior, recipe incompatibility
   - **Priority**: HIGH
   - **Fix**: Implement rendering compatibility and continuity tests

2. **8-bit Processing Bottleneck** (FOTO-DEVELOP-PARITY.md:33)
   - **Issue**: LibRaw configured with `output_bps=8`, ImageIO uses 8-bit sRGB context
   - **Impact**: Precision loss, gamut limitation, highlight data loss
   - **Priority**: HIGH
   - **Fix**: Implement 16-bit processing pipeline

3. **Curve Point Drag State Management** (DevelopControls.tsx:166-260)
   - **Issue**: Complex drag state management with potential race conditions
   - **Impact**: UI desync, lost edits during rapid interactions
   - **Priority**: MEDIUM
   - **Fix**: Simplify state management, add proper error boundaries

### Medium Priority Bugs

4. **Mask Limitation** (contract.ts:137)
   - **Issue**: Hard limit of 12 masks without UI indication
   - **Impact**: User confusion when limit reached
   - **Priority**: MEDIUM
   - **Fix**: Add UI feedback, consider increasing limit

5. **Export Size Limitations** (contract.ts:198-206)
   - **Issue**: Multiple overlapping size limits (8K edge, 36M pixels, 32MiB JPEG)
   - **Impact**: Inconsistent export behavior
   - **Priority**: MEDIUM
   - **Fix**: Clearer limits, better error messaging

6. **Histogram Clipping Detection** (FOTO-DEVELOP-PARITY.md:21)
   - **Issue**: "Black" counts all channels zero, not true black clipping
   - **Impact**: Inaccurate clipping indicators
   - **Priority**: MEDIUM
   - **Fix**: Implement proper channel-independent clipping detection

### Low Priority Bugs

7. **Import Failure Handling** (DevelopPage.tsx:1881-1896)
   - **Issue**: Basic import failure reporting without recovery options
   - **Impact**: Poor user experience during import errors
   - **Priority**: LOW
   - **Fix**: Enhanced error recovery, retry mechanisms

8. **Crop Aspect Ratio Precision** (DevelopControls.tsx:561-568)
   - **Issue**: Aspect ratio matching uses 0.015 tolerance, may not be precise enough
   - **Impact**: Slight aspect ratio mismatches
   - **Priority**: LOW
   - **Fix**: Improve precision, add custom aspect ratio input

## Implementation Priority Plan

### Phase 1: Critical Bug Fixes (Week 1-2)

1. **Fix White Balance Discontinuity**
   - Implement consistent WB baseline selection
   - Add comprehensive WB testing
   - Maintain backward compatibility

2. **Implement 16-bit Processing Pipeline**
   - Update LibRaw configuration to 16-bit
   - Modify ImageIO context for high-bit processing
   - Update native C++ pipeline for float precision
   - Add 16-bit export options (TIFF/PSD)

3. **Improve Curve Drag State Management**
   - Refactor drag state handling
   - Add proper error boundaries
   - Improve undo/redo integration

### Phase 2: Core Lightroom Classic Features (Week 3-6)

4. **Advanced Masking System**
   - Implement brush/eraser tools with flow/density
   - Add AI masking (Subject, Sky, People)
   - Implement luminance/color range masking
   - Add mask intersections/subtractions
   - Implement mask brushing with size/feather/hardness

5. **Parametric Tone Curves**
   - Add Highlight/Shadows/Whites/Blacks regions
   - Implement region-based curve editing
   - Add parametric-to-point conversion
   - Integrate with existing point curves

6. **Lens Correction System**
   - Implement lens profile database
   - Add manual chromatic aberration correction
   - Implement defringe controls
   - Add vignette correction
   - Implement perspective-aware distortion correction

7. **Color Calibration System**
   - Add camera profile selection
   - Implement process version controls
   - Add calibration panel (RGB primaries, tone curve)
   - Implement custom profile creation

### Phase 3: Advanced Processing Features (Week 7-10)

8. **Perspective Transform**
   - Implement Upright auto-correction
   - Add manual perspective controls
   - Implement guided perspective correction
   - Add level/vertical/horizontal guides

9. **AI Denoise**
   - Implement machine learning denoising
   - Add RAW-specific denoise
   - Implement detail-aware noise reduction
   - Add noise reduction preview

10. **HDR Merge**
    - Implement bracketed exposure merge
    - Add ghost removal
    - Implement tone mapping controls
    - Add deghosting preview

11. **Panorama Merge**
    - Implement image stitching
    - Add projection controls (spherical, cylindrical, perspective)
    - Implement boundary warp
    - Add auto-fill edges

### Phase 4: Professional Workflow Features (Week 11-14)

12. **Soft Proofing**
    - Implement printer profile selection
    - Add rendering intent controls
    - Implement gamut warning
    - Add soft proof preview

13. **Advanced Export System**
    - Add TIFF/PSD export with 16-bit support
    - Implement batch export queue
    - Add watermarking system
    - Implement output sharpening
    - Add export presets

14. **Print Module**
    - Implement print layout system
    - Add print templates
    - Implement color-managed printing
    - Add print package generation

15. **Tethered Shooting**
    - Implement camera connection
    - Add live view support
    - Implement remote camera control
    - Add auto-import on capture

### Phase 5: Superior Features (Week 15-20)

16. **Enhanced AI System**
    - Implement superior AI masking (beyond Adobe)
    - Add AI-based edit suggestions
    - Implement style transfer
    - Add content-aware fill beyond removal

17. **Advanced Color System**
    - Implement wide-gamut editing (ProPhoto, Display P3)
    - Add color space conversion
    - Implement advanced color grading
    - Add color grading presets

18. **Collaborative Features**
    - Implement real-time collaboration
    - Add shared editing sessions
    - Implement version control
    - Add comment/annotation system

19. **Performance Optimizations**
    - Implement GPU acceleration
    - Add smart caching
    - Implement background processing
    - Add progressive rendering

20. **Cross-Platform Native**
    - Extend C++ engine to Windows
    - Add Linux support
    - Implement mobile native processing
    - Add web assembly for web native

## Technical Implementation Details

### Bug Fix Implementation

#### 1. White Balance Discontinuity Fix
```typescript
// src/lib/develop/contract.ts
export function developSettingsWithConsistentWB(settings: DevelopSettings): DevelopSettings {
  // Implement consistent WB baseline selection
  if (settings.temperature === 0 && settings.tint === 0) {
    // Use consistent baseline whether camera WB is present or not
    return {
      ...settings,
      wbBaseline: 'daylight', // Explicit baseline
    };
  }
  return settings;
}
```

#### 2. 16-bit Processing Pipeline
```cpp
// native/src/develop_raw.cpp
void configure16BitProcessing() {
  // Update LibRaw configuration
  libraw->output_bps = 16; // Changed from 8
  
  // Configure ImageIO for high-bit processing
  CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceDisplayP3);
  // Use 16-bit context
  CGContextRef context = CGBitmapContextCreate(
    data, width, height, 16, bytesPerRow, colorSpace,
    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder16Little
  );
}
```

### Feature Implementation Examples

#### Advanced Masking System
```typescript
// src/lib/develop/contract.ts
export const developAdvancedMaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['brush', 'linear', 'radial', 'ai_subject', 'ai_sky', 'ai_people', 'range']),
  enabled: z.boolean(),
  // Brush-specific
  brushPoints: z.array(z.object({
    x: z.number(),
    y: z.number(),
    size: z.number(),
    hardness: z.number(),
    flow: z.number(),
    density: z.number(),
  })).optional(),
  // AI-specific
  aiConfidence: z.number().optional(),
  aiModel: z.string().optional(),
  // Range-specific
  luminanceRange: z.object({
    min: z.number(),
    max: z.number(),
  }).optional(),
  colorRange: z.object({
    hue: z.number(),
    saturation: z.number(),
  }).optional(),
  // Common adjustments
  adjustments: z.object({
    exposure: z.number(),
    temperature: z.number(),
    saturation: z.number(),
    // ... all other adjustments
  }),
});
```

#### Parametric Curves
```typescript
// src/lib/develop/contract.ts
export const developParametricCurveSchema = z.object({
  highlights: z.number().min(-100).max(100),
  lights: z.number().min(-100).max(100),
  darks: z.number().min(-100).max(100),
  shadows: z.number().min(-100).max(100),
  pointCurve: developCurveSchema, // Combined with point curve
});

export type DevelopParametricCurve = z.infer<typeof developParametricCurveSchema>;
```

## Testing Strategy

### Unit Testing
- Each bug fix needs comprehensive unit tests
- Feature implementation requires test coverage >80%
- Test edge cases and boundary conditions

### Integration Testing
- Test interactions between develop components
- Test native C++ ↔ JavaScript integration
- Test cross-component state management

### Performance Testing
- Benchmark 16-bit vs 8-bit processing
- Test AI masking performance
- Measure export speed improvements

### User Acceptance Testing
- Test with real photographer workflows
- Compare results with Lightroom Classic/CC
- Validate professional feature parity

## Success Metrics

### Bug Fix Metrics
- All critical bugs resolved within 2 weeks
- Zero regressions in existing functionality
- 100% test coverage for bug fixes

### Feature Parity Metrics
- 90% feature parity with Lightroom Classic develop module
- 95% feature parity with Lightroom CC develop module
- Superior performance in 50% of shared features

### Superior Features Metrics
- At least 5 features superior to both Adobe products
- 2x faster processing for equivalent operations
- Better user experience metrics

## Timeline & Resources

### Phase 1 (Weeks 1-2): Critical Bug Fixes
- **Effort**: 80 hours
- **Resources**: Senior developer + C++ specialist
- **Deliverables**: All critical bugs fixed, 16-bit pipeline

### Phase 2 (Weeks 3-6): Core Lightroom Classic Features
- **Effort**: 160 hours
- **Resources**: 2 developers + AI specialist
- **Deliverables**: Advanced masking, parametric curves, lens correction

### Phase 3 (Weeks 7-10): Advanced Processing Features
- **Effort**: 200 hours
- **Resources**: 2 developers + ML engineer
- **Deliverables**: Perspective, AI denoise, HDR/panorama

### Phase 4 (Weeks 11-14): Professional Workflow Features
- **Effort**: 160 hours
- **Resources**: 2 developers
- **Deliverables**: Soft proofing, advanced export, print module

### Phase 5 (Weeks 15-20): Superior Features
- **Effort**: 240 hours
- **Resources**: 3 developers + AI researcher
- **Deliverables**: Enhanced AI, advanced color, collaboration

## Risk Mitigation

### Technical Risks
- **16-bit Pipeline**: May break existing functionality
  - **Mitigation**: Comprehensive testing, gradual rollout
- **AI Features**: May not match Adobe quality
  - **Mitigation**: Benchmark against Adobe, iterate quickly
- **Performance**: New features may slow down application
  - **Mitigation**: Performance profiling, optimization

### Resource Risks
- **C++ Expertise**: Limited C++ development resources
  - **Mitigation**: Hire C++ consultant, train existing team
- **AI Development**: ML expertise required
  - **Mitigation**: Partner with AI research lab, use existing models

### Schedule Risks
- **Scope Creep**: Features may expand beyond timeline
  - **Mitigation**: Strict prioritization, regular review
- **Integration Issues**: New features may not integrate well
  - **Mitigation**: Incremental integration, continuous testing

## Conclusion

This plan provides a comprehensive roadmap to reverse engineer Lightroom Classic and Lightroom CC, fix existing bugs, and implement superior features. The phased approach ensures critical issues are addressed first while building toward a professional-grade photo editing solution that exceeds Adobe's current offerings.

The key to success is maintaining the existing non-destructive editing philosophy while adding professional features and superior AI capabilities. The hybrid local/cloud approach will provide the best of both Lightroom Classic's local performance and Lightroom CC's cross-device sync.
