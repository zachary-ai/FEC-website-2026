// Netlify serverless function for LinkedIn Profile Analysis
// Uses Claude API with vision to analyse PDF exports and screenshots

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are an expert LinkedIn profile optimisation specialist for fractional executives.

You will receive a LinkedIn profile in two possible formats:
1. A PDF export from LinkedIn (always provided) - contains structured text data
2. A screenshot of the profile page (optionally provided) - shows visual layout and presentation

Analyse the profile thoroughly and return a JSON response with this exact structure:

{
  "executiveSummary": {
    "score": 75,
    "verdict": "One sentence overall assessment",
    "topStrength": "Their biggest strength",
    "criticalGap": "The most important thing to fix"
  },
  "headline": {
    "current": "Their current headline exactly as written",
    "score": 70,
    "issues": ["Issue 1", "Issue 2"],
    "alternatives": [
      "Alternative headline 1 - best option",
      "Alternative headline 2",
      "Alternative headline 3"
    ],
    "reasoning": "Why these alternatives work better"
  },
  "about": {
    "current": "First 200 characters of their about section...",
    "score": 65,
    "strengths": ["Strength 1", "Strength 2"],
    "improvements": ["Improvement 1", "Improvement 2", "Improvement 3"],
    "rewrite": "A complete rewritten about section optimised for fractional positioning. Should be 3-4 paragraphs covering: hook/value prop, specific outcomes delivered, approach/methodology, and soft CTA."
  },
  "experience": {
    "score": 70,
    "currentRoleAnalysis": "Analysis of how their current fractional role is positioned",
    "improvements": ["Improvement 1", "Improvement 2"],
    "missingElements": ["Missing element 1", "Missing element 2"]
  },
  "visualAnalysis": {
    "available": true,
    "profilePhoto": {
      "assessment": "Professional/unprofessional/missing - why",
      "recommendation": "Specific recommendation"
    },
    "bannerImage": {
      "assessment": "Assessment of banner image",
      "recommendation": "Specific recommendation"
    },
    "overallPresentation": "How the profile looks at first glance",
    "standoutElements": ["Element 1", "Element 2"],
    "visualImprovements": ["Visual improvement 1", "Visual improvement 2"]
  },
  "actions": [
    {
      "priority": 1,
      "action": "Specific action to take",
      "section": "Headline|About|Experience|Photo|Banner|Featured",
      "time": "5min|15min|30min|1hr",
      "impact": "High|Medium|Low",
      "why": "Brief explanation of why this matters for client acquisition"
    }
  ]
}

SCORING GUIDELINES:
- 90-100: Excellent - Clear fractional positioning, compelling outcomes, strong differentiation, professional visual presence
- 75-89: Good - Clear role but missing specificity, outcomes, or visual polish
- 60-74: Average - Generic positioning, unclear value proposition, room for improvement
- Below 60: Needs significant work - Reads like an employee resume, not a fractional executive offer

ANALYSIS FOCUS AREAS:
1. Fractional executive positioning (not employee, not generic consultant)
2. Clear value proposition and measurable outcomes
3. Attracting inbound leads from companies needing fractional support
4. Standing out from other fractionals in their space
5. Demonstrating expertise through specifics, not bragging
6. Professional visual presentation (if screenshot provided)
7. Featured section utilisation
8. Recommendations and social proof

TIME ESTIMATES:
- 5min: Quick text edits, minor tweaks
- 15min: Rewriting a section
- 30min: Strategic repositioning or research
- 1hr: Complete overhaul of a section with research

IMPACT RATINGS:
- High: Directly affects client acquisition and first impressions
- Medium: Improves credibility and professional perception
- Low: Nice to have, polishing touches

If no screenshot is provided, set visualAnalysis.available to false and provide general best practice recommendations instead of specific observations.

IMPORTANT: Return ONLY valid JSON. No markdown formatting, no explanation text, no code blocks. Just the raw JSON object.`;

exports.handler = async function (event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { pdf, screenshot, email } = JSON.parse(event.body);

    // Validate PDF is provided
    if (!pdf) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'PDF export is required. Please upload your LinkedIn PDF.',
        }),
      };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Server configuration error. Please try again later.',
        }),
      };
    }

    // Initialize Anthropic client
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Build the message content array
    const content = [];

    // Add the PDF as a document
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdf,
      },
    });

    // Add screenshot if provided
    if (screenshot) {
      // Determine image type from base64 header or default to PNG
      let mediaType = 'image/png';
      if (screenshot.startsWith('/9j/')) {
        mediaType = 'image/jpeg';
      } else if (screenshot.startsWith('iVBOR')) {
        mediaType = 'image/png';
      } else if (screenshot.startsWith('R0lGOD')) {
        mediaType = 'image/gif';
      } else if (screenshot.startsWith('UklGR')) {
        mediaType = 'image/webp';
      }

      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: screenshot,
        },
      });
    }

    // Add the instruction text
    content.push({
      type: 'text',
      text: `Please analyse this LinkedIn profile thoroughly.

${screenshot ? 'I have provided both the PDF export (for structured text data) and a full-page screenshot (for visual analysis).' : 'I have provided the PDF export. No screenshot was provided, so please provide general visual best practice recommendations.'}

Provide a comprehensive analysis following the JSON structure specified in your instructions. Focus on optimising this profile for a fractional executive positioning.`,
    });

    // Call Claude API
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: content,
        },
      ],
    });

    // Extract the text response
    const responseText = message?.content?.[0]?.text || '';

    // Parse the JSON response
    let analysis;
    try {
      analysis = JSON.parse(responseText);
    } catch (parseError) {
      // If JSON parsing fails, try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        console.error('Failed to parse response:', responseText.substring(0, 500));
        throw new Error('Failed to parse AI response');
      }
    }

    // Log email for future follow-up
    if (email) {
      console.log('Email captured:', email);
      // TODO: Store email + analysis summary in Airtable/Notion/database
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(analysis),
    };
  } catch (error) {
    console.error('Error:', error);

    // Provide more specific error messages
    let errorMessage = 'Analysis failed. Please try again.';
    if (error.message?.includes('Could not process image')) {
      errorMessage = 'Could not process the screenshot. Please ensure it is a valid image file (PNG, JPG, or WebP).';
    } else if (error.message?.includes('Could not process document')) {
      errorMessage = 'Could not process the PDF. Please ensure it is a valid LinkedIn PDF export.';
    } else if (error.status === 413 || error.message?.includes('too large')) {
      errorMessage = 'Files are too large. Please try with a smaller screenshot or PDF.';
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
      }),
    };
  }
};
