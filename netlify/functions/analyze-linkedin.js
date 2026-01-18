// Netlify serverless function for LinkedIn Profile Analysis
// Uses Claude API to analyze profiles

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are a LinkedIn optimization expert specializing in fractional executives.

Analyze the provided LinkedIn profile text and return a JSON response with this exact structure:

{
  "score": 75,
  "scoreExplanation": "Brief explanation of the score",
  "headline": {
    "current": "The user's current headline",
    "issues": "What's wrong with it",
    "alternatives": [
      "Alternative headline 1",
      "Alternative headline 2",
      "Alternative headline 3"
    ]
  },
  "about": {
    "strengths": "What works well in the about section",
    "improvements": "Specific suggestions for improvement",
    "rewrite": "A complete rewritten about section"
  },
  "actions": [
    {
      "action": "Specific action to take",
      "time": "5min",
      "impact": "High",
      "why": "Brief explanation of why this matters"
    },
    {
      "action": "Second action",
      "time": "15min",
      "impact": "Medium",
      "why": "Brief explanation"
    },
    {
      "action": "Third action",
      "time": "30min",
      "impact": "High",
      "why": "Brief explanation"
    }
  ]
}

Scoring guidelines:
- 90-100: Excellent - clear fractional positioning, compelling outcomes, strong differentiation
- 75-89: Good - clear role but missing specificity or outcomes
- 60-74: Average - generic positioning, unclear value proposition
- Below 60: Needs work - reads like an employee resume, not a fractional offer

Focus your analysis on:
1. Positioning as a fractional executive (not employee or generic consultant)
2. Clear value proposition and outcomes they deliver
3. Attracting inbound leads from companies
4. Standing out from other fractionals
5. Demonstrating expertise without bragging
6. Specific numbers and results

Time estimates for actions:
- 5min: Quick text edits
- 15min: Rewriting sections
- 30min: Strategic repositioning or research

Impact ratings:
- High: Directly affects client acquisition
- Medium: Improves credibility
- Low: Nice to have

IMPORTANT: Return ONLY valid JSON, no markdown formatting or explanation text.`;

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
    const { profileText, email } = JSON.parse(event.body);

    if (!profileText || profileText.trim().length < 50) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Please provide more profile text (at least headline and about section).',
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
          error: 'Server missing ANTHROPIC_API_KEY configuration.',
        }),
      };
    }

    // Initialize Anthropic client
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Call Claude API
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Please analyze this LinkedIn profile:\n\n${profileText}`,
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
        throw new Error('Failed to parse AI response');
      }
    }

    // Optional: Store email for follow-up (implement your own storage)
    if (email) {
      // TODO: Store email + analysis summary in Airtable/Notion/database
      // For now, just log it
      console.log('Email captured:', email);
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

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Analysis failed. Please try again.',
        details: error?.message,
      }),
    };
  }
};
