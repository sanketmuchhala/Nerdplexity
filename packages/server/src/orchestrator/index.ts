/**
 * PERPLEXITY++ ORCHESTRATOR
 * 
 * Main orchestration engine that applies the 9-layer system to every request
 */

import { 
  ChatRequest, 
  ChatResponse, 
  PromptOrchestration,
  WebSearchResult,
  TaskType
} from '../types.js';

import { 
  generateOrchestrationPrompt, 
  detectTaskType,
  extractAssumptions,
  extractConfidence,
  extractFollowUps,
  extractReportCard
} from './spec.js';

import { performWebSearch, extractSearchQuery, enhancePromptWithWebResults } from '../services/webSearch.js';

export class PromptOrchestrator {
  
  /**
   * Main orchestration method - applies all 9 layers
   */
  async orchestrate(request: ChatRequest): Promise<{
    enhancedRequest: ChatRequest;
    orchestration: PromptOrchestration;
    webSearchResults: WebSearchResult[];
  }> {
    console.log(`[ORCHESTRATOR] Starting orchestration for ${request.messages.length} messages`);
    
    // Get the last user message for analysis
    const lastMessage = request.messages[request.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('Last message must be from user for orchestration');
    }
    
    const originalQuery = lastMessage.content;
    
    // LAYER 1 & 2: Query Analysis & Task Detection
    const taskType = detectTaskType(originalQuery);
    const rewrittenQuery = this.rewriteQuery(originalQuery, taskType);
    
    console.log(`[ORCHESTRATOR] Detected task type: ${taskType}`);
    
    // LAYER 3: Web Search (if enabled)
    let webSearchResults: WebSearchResult[] = [];
    if (request.web_search && (taskType === 'research' || originalQuery.toLowerCase().includes('latest'))) {
      try {
        const searchQuery = extractSearchQuery(rewrittenQuery || originalQuery);
        console.log(`[ORCHESTRATOR] Performing web search: ${searchQuery}`);
        webSearchResults = await performWebSearch(searchQuery);
      } catch (error) {
        console.error('[ORCHESTRATOR] Web search failed:', error);
      }
    }
    
    // Create orchestration metadata
    const orchestration: PromptOrchestration = {
      originalQuery,
      rewrittenQuery: rewrittenQuery !== originalQuery ? rewrittenQuery : undefined,
      taskType,
      webSearchEnabled: request.web_search,
      reasoningEnabled: request.show_reasoning,
      assumptions: this.generateAssumptions(originalQuery, taskType, webSearchResults.length > 0)
    };
    
    // Build enhanced system prompt with orchestration
    const contextInfo = this.buildContextInfo(request.messages, webSearchResults);
    const orchestrationPrompt = generateOrchestrationPrompt(
      rewrittenQuery,
      taskType,
      request.web_search || false,
      request.show_reasoning || false,
      contextInfo
    );
    
    // Enhanced request with orchestration system prompt
    const systemMessage = {
      role: 'system' as const,
      content: orchestrationPrompt,
      id: 'orchestrator-' + Date.now(),
      timestamp: Date.now()
    };
    
    // Build enhanced messages
    let enhancedMessages = request.messages;
    
    // Add web search context to user message if available
    if (webSearchResults.length > 0) {
      const enhancedContent = enhancePromptWithWebResults(originalQuery, webSearchResults);
      enhancedMessages = [
        ...request.messages.slice(0, -1),
        { ...lastMessage, content: enhancedContent }
      ];
    }
    
    // Insert system message at beginning
    enhancedMessages = [systemMessage, ...enhancedMessages];
    
    const enhancedRequest: ChatRequest = {
      ...request,
      messages: enhancedMessages,
      orchestration
    };
    
    console.log(`[ORCHESTRATOR] Orchestration complete. Web results: ${webSearchResults.length}`);
    
    return {
      enhancedRequest,
      orchestration,
      webSearchResults
    };
  }
  
  /**
   * Post-process the AI response to extract orchestration outputs
   */
  processResponse(response: ChatResponse, orchestration: PromptOrchestration): ChatResponse {
    const content = response.message.content;
    
    // Extract orchestration elements
    const assumptions = extractAssumptions(content);
    const confidence = extractConfidence(content);
    const followUps = extractFollowUps(content);
    const reportCard = extractReportCard(content);
    
    // Clean up the main content by removing orchestration markers
    let cleanedContent = content
      .replace(/\*\*Assumptions:\*\*[^*]*?(?=\n\n|\*\*|$)/s, '')
      .replace(/\*\*Confidence:\*\*[^*]*?(?=\n\n|\*\*|$)/s, '')
      .replace(/\*\*Follow-ups:\*\*[^*]*?(?=\n\n|\*\*|$)/s, '')
      .replace(/\*\*Report Card:\*\*[^*]*?$/s, '')
      .trim();
    
    // Build enhanced response
    const enhancedResponse: ChatResponse = {
      ...response,
      message: {
        ...response.message,
        content: cleanedContent,
        metadata: {
          ...response.message.metadata,
          assumptions: assumptions.length > 0 ? assumptions : undefined,
          confidence,
          followUps: followUps.length > 0 ? followUps : undefined,
          reportCard: reportCard || undefined
        }
      },
      assumptions: assumptions.length > 0 ? assumptions : undefined,
      confidence,
      followUps: followUps.length > 0 ? followUps : undefined,
      reportCard: reportCard || undefined
    };
    
    console.log(`[ORCHESTRATOR] Response processed. Confidence: ${confidence}, Follow-ups: ${followUps.length}`);
    
    return enhancedResponse;
  }
  
  /**
   * LAYER 1: Query Rewrite - enhance for precision
   */
  private rewriteQuery(query: string, taskType: TaskType): string {
    // Simple query enhancement based on task type
    switch (taskType) {
      case 'research':
        return query.includes('latest') 
          ? query 
          : `${query} (provide current information with sources and dates)`;
          
      case 'code':
        return `${query} (provide working code with explanations and best practices)`;
        
      case 'write':
        return `${query} (create well-structured content with clear organization)`;
        
      case 'math':
        return `${query} (show step-by-step solution with explanations)`;
        
      case 'critique':
        return `${query} (provide balanced analysis with specific examples)`;
        
      default:
        return query;
    }
  }
  
  /**
   * Generate initial assumptions based on query analysis
   */
  private generateAssumptions(query: string, taskType: TaskType, hasWebResults: boolean): string[] {
    const assumptions: string[] = [];
    
    // Task-specific assumptions
    if (taskType === 'code' && !query.includes('language')) {
      assumptions.push('Assuming modern JavaScript/TypeScript unless specified');
    }
    
    if (taskType === 'research' && !hasWebResults) {
      assumptions.push('Using knowledge cutoff data; web search disabled');
    }
    
    if (query.includes('best') || query.includes('recommend')) {
      assumptions.push('Assuming general use case unless context specified');
    }
    
    return assumptions;
  }
  
  /**
   * Build context information from conversation history
   */
  private buildContextInfo(messages: any[], webResults: WebSearchResult[]): string {
    let context = '';
    
    // Add conversation context if multi-turn
    if (messages.length > 2) {
      context += `Multi-turn conversation with ${Math.floor((messages.length - 1) / 2)} previous exchanges. `;
    }
    
    // Add web search context
    if (webResults.length > 0) {
      context += `Web search returned ${webResults.length} current sources. `;
    }
    
    return context.trim();
  }
}

// Export singleton instance
export const orchestrator = new PromptOrchestrator();
