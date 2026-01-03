import fetch from 'cross-fetch';
import { bedrockChatOnce } from '../lib/bedrockRuntime.js';

export interface ExtractRequest {
  variableName: string;
  description: string;
  scope: 'last' | 'transcript';
  lastAssistant?: string;
  transcript?: any[];
}

export interface ExtractResult {
  success: boolean;
  value: any;
  reasoning?: string;
  error?: string;
}

/**
 * Uses an LLM to extract structured data from the conversation.
 * The LLM analyzes the conversation (or last message) and extracts
 * the requested information based on the description provided.
 */
export async function extractFromConversation(req: ExtractRequest): Promise<ExtractResult> {
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const openaiBase = process.env.OPENAI_BASE || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const extractProvider = (process.env.EXTRACT_PROVIDER || process.env.JUDGE_PROVIDER || '').toLowerCase();

  // Determine what text to analyze based on scope
  const contextText = req.scope === 'transcript'
    ? JSON.stringify(req.transcript || [], null, 2)
    : String(req.lastAssistant || '');

  if (!contextText.trim()) {
    return {
      success: false,
      value: null,
      error: 'no_content_to_extract_from',
    };
  }

  // Fallback heuristic if no LLM available
  if (!openaiKey && extractProvider !== 'bedrock') {
    // Simple pattern-based extraction for common cases
    const text = contextText;
    
    // Try to extract numbers, IDs, dates, etc. based on description
    const descLower = req.description.toLowerCase();
    
    if (descLower.includes('id') || descLower.includes('number') || descLower.includes('code')) {
      // Look for alphanumeric IDs
      const idMatch = text.match(/\b([A-Z0-9]{6,}|[a-z0-9-]{8,}|\d{5,})\b/i);
      if (idMatch) {
        return { success: true, value: idMatch[1], reasoning: 'heuristic_id_extraction' };
      }
    }
    
    if (descLower.includes('amount') || descLower.includes('price') || descLower.includes('balance')) {
      // Look for currency amounts
      const amountMatch = text.match(/\$?([\d,]+\.?\d*)/);
      if (amountMatch) {
        return { success: true, value: amountMatch[1].replace(/,/g, ''), reasoning: 'heuristic_amount_extraction' };
      }
    }
    
    if (descLower.includes('date') || descLower.includes('time')) {
      // Look for dates
      const dateMatch = text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/);
      if (dateMatch) {
        return { success: true, value: dateMatch[1], reasoning: 'heuristic_date_extraction' };
      }
    }

    return {
      success: false,
      value: null,
      reasoning: 'heuristic_extraction_no_match',
      error: 'Could not extract value without LLM. Set OPENAI_API_KEY or JUDGE_PROVIDER=bedrock.',
    };
  }

  const sys = [
    'You are a data extraction assistant.',
    'Your task is to extract a specific piece of information from the conversation.',
    'Return ONLY valid JSON matching this structure:',
    '{ "success": boolean, "value": any, "reasoning": string }',
    '',
    'Guidelines:',
    '- If you can find the requested information, set success=true and value to the extracted data',
    '- The value can be a string, number, boolean, object, or array depending on what was requested',
    '- If extracting a number, return it as a number type, not a string',
    '- If the information is not found, set success=false and value=null',
    '- Keep reasoning brief (<30 words)',
    'Do not include any text outside the JSON.',
  ].join('\n');

  const user = JSON.stringify({
    variableName: req.variableName,
    extractionDescription: req.description,
    scope: req.scope,
    content: contextText,
  });

  let out: any = undefined;

  if (extractProvider === 'bedrock') {
    try {
      const bedrockModelId = process.env.BEDROCK_JUDGE_MODEL_ID || process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
      const bedrockTemp = process.env.BEDROCK_JUDGE_TEMPERATURE
        ? Number(process.env.BEDROCK_JUDGE_TEMPERATURE)
        : (process.env.BEDROCK_TEMPERATURE ? Number(process.env.BEDROCK_TEMPERATURE) : 0.1);
      
      const reply = await bedrockChatOnce({
        modelId: bedrockModelId,
        temperature: bedrockTemp,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
      });
      
      const jsonStr = String(reply || '').replace(/^```json\n?|```$/g, '').trim();
      out = JSON.parse(jsonStr);
    } catch (e: any) {
      return {
        success: false,
        value: null,
        error: `extraction_error: ${e?.message || 'bedrock_failed'}`,
      };
    }
  } else {
    // OpenAI
    const payload: any = {
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.1, // Low temperature for extraction accuracy
    };

    try {
      const resp = await fetch(`${openaiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const txt = await resp.text();
      if (!resp.ok) {
        return {
          success: false,
          value: null,
          error: `extraction_error: ${txt.slice(0, 200)}`,
        };
      }

      const jr = JSON.parse(txt);
      const content = String(jr?.choices?.[0]?.message?.content || '').trim();
      const jsonStr = content.replace(/^```json\n?|```$/g, '').trim();
      out = JSON.parse(jsonStr);
    } catch (e: any) {
      return {
        success: false,
        value: null,
        error: `extraction_parse_error: ${e?.message}`,
      };
    }
  }

  if (!out || typeof out.success !== 'boolean') {
    return {
      success: false,
      value: null,
      error: 'extraction_parse_failed',
    };
  }

  return {
    success: out.success,
    value: out.value,
    reasoning: out.reasoning,
    error: out.success ? undefined : 'value_not_found',
  };
}
