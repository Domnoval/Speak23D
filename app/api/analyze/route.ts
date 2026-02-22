import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request: NextRequest) {
  try {
    const { imageData } = await request.json();
    
    if (!imageData) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const prompt = `Analyze this photo of a building/surface where a house number or sign will be mounted. Identify:
1. Surface material (brick, wood siding, stucco, stone, metal, concrete, etc.)
2. Surface color (dominant color hex)
3. Architectural style (modern, traditional, craftsman, colonial, industrial, etc.)
4. Lighting conditions (bright sun, overcast, shade, night)
5. Suggested mounting surface (wall, door, fence, mailbox, rock, post)
6. Recommended sign style:
   - Font style (sans-serif for modern, serif for traditional, script for elegant)
   - LED color that would complement the surface
   - Build type (floating letters, backplate, full housing)
   - Approximate size based on the apparent scale

Return as JSON with keys: surface_material, surface_color, architectural_style, lighting, mounting_surface, recommendations (object with font, led_color, build_type, size_preset)`;

    const response = await anthropic.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageData.startsWith('data:image/png') ? "image/png" : "image/jpeg",
                data: imageData.replace(/^data:image\/[^;]+;base64,/, '')
              }
            },
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ]
    });

    // Extract text content from response
    const textContent = response.content.find(content => content.type === 'text');
    if (!textContent) {
      return NextResponse.json({ error: 'No text response from Claude' }, { status: 500 });
    }

    // Try to parse JSON from the response
    let analysisResult;
    try {
      // Find JSON in the response (may be wrapped in markdown code blocks)
      const jsonMatch = textContent.text.match(/```json\s*(\{[\s\S]*\})\s*```/) || 
                        textContent.text.match(/(\{[\s\S]*\})/);
      
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      // If parsing fails, create a structured response from the text
      analysisResult = {
        surface_material: "unknown",
        surface_color: "#888888",
        architectural_style: "modern",
        lighting: "daylight",
        mounting_surface: "wall",
        recommendations: {
          font: "helvetiker", // Maps to existing font options
          led_color: "warm_white",
          build_type: "housing",
          size_preset: "front_door"
        },
        raw_response: textContent.text
      };
    }

    return NextResponse.json({ analysis: analysisResult });

  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze image', details: error instanceof Error ? error.message : String(error) }, 
      { status: 500 }
    );
  }
}