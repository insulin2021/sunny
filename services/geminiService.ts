
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export async function analyzeDiaryEntry(content: string) {
  if (!content || !process.env.API_KEY) return null;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `다음 일기 내용을 분석해서 기분(mood: happy, sad, angry, calm, excited, tired, anxious 중 하나)과 짧은 격려의 메시지를 JSON 형식으로 작성해줘: "${content}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mood: { type: Type.STRING, description: "One of the predefined mood keys" },
            analysis: { type: Type.STRING, description: "A short supportive message in Korean" },
            suggestedTitle: { type: Type.STRING, description: "A creative short title for the diary entry" }
          },
          required: ["mood", "analysis", "suggestedTitle"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("AI Analysis failed:", error);
    return null;
  }
}
