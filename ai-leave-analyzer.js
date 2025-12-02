// AI Leave Management Analyzer - Phase 2
// Provides credibility scoring and pattern analysis for leave requests

class AILeaveAnalyzer {
  constructor() {
    this.patterns = {
      suspicious: {
        frequentRequests: 0.3,      // More than 3 requests per month
        weekendPattern: 0.2,        // Requests often on Fridays/Mondays
        examPeriodPattern: 0.4,     // Requests during exam periods
        shortNoticePattern: 0.3,    // Same-day or next-day requests
        vaguereasonPattern: 0.2,    // Very short or vague reasons
        duplicateReasonPattern: 0.4 // Same reason used multiple times
      },
      credible: {
        medicalDocumentation: 0.8,  // Medical reasons with proper documentation
        familyEmergency: 0.7,       // Family emergencies with details
        advanceNotice: 0.6,         // Requests made well in advance
        detailedReason: 0.5,        // Detailed, specific reasons
        lowFrequency: 0.4,          // Infrequent requests
        consistentPattern: 0.3      // Consistent, reasonable patterns
      }
    };
  }

  // Main analysis function
  async analyzeLeaveRequest(request, studentHistory) {
    const analysis = {
      credibilityScore: 0,
      riskLevel: 'low',
      patterns: [],
      recommendations: [],
      flags: []
    };

    // Calculate credibility score
    analysis.credibilityScore = this.calculateCredibilityScore(request, studentHistory);
    
    // Determine risk level
    analysis.riskLevel = this.determineRiskLevel(analysis.credibilityScore);
    
    // Detect patterns
    analysis.patterns = this.detectPatterns(request, studentHistory);
    
    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(analysis);
    
    // Generate flags
    analysis.flags = this.generateFlags(request, studentHistory);

    return analysis;
  }

  // Calculate credibility score (0-100)
  calculateCredibilityScore(request, history) {
    let score = 50; // Base score
    
    // Analyze request frequency
    const recentRequests = this.getRecentRequests(history, 30); // Last 30 days
    if (recentRequests.length > 3) {
      score -= 20; // Frequent requests reduce credibility
    } else if (recentRequests.length === 0) {
      score += 10; // First request in a while increases credibility
    }

    // Analyze advance notice
    const daysInAdvance = this.getDaysInAdvance(request.leaveDate);
    if (daysInAdvance >= 7) {
      score += 15; // Good advance notice
    } else if (daysInAdvance <= 1) {
      score -= 15; // Short notice reduces credibility
    }

    // Analyze reason quality
    const reasonScore = this.analyzeReasonQuality(request.reasonText);
    score += reasonScore;

    // Check for weekend patterns
    if (this.isWeekendPattern(request.leaveDate, history)) {
      score -= 10;
    }

    // Check for exam period
    if (this.isExamPeriod(request.leaveDate)) {
      score -= 15;
    }

    // Check for duplicate reasons
    if (this.hasDuplicateReasons(request.reasonText, history)) {
      score -= 20;
    }

    // Ensure score is within bounds
    return Math.max(0, Math.min(100, score));
  }

  // Analyze reason text quality
  analyzeReasonQuality(reasonText) {
    if (!reasonText || reasonText.trim().length < 10) {
      return -15; // Very short reason
    }
    
    if (reasonText.length < 30) {
      return -5; // Short reason
    }
    
    if (reasonText.length > 100) {
      return 10; // Detailed reason
    }
    
    // Check for medical keywords
    const medicalKeywords = ['doctor', 'hospital', 'medical', 'sick', 'fever', 'appointment'];
    if (medicalKeywords.some(keyword => reasonText.toLowerCase().includes(keyword))) {
      return 15;
    }
    
    // Check for family keywords
    const familyKeywords = ['family', 'wedding', 'funeral', 'emergency', 'relative'];
    if (familyKeywords.some(keyword => reasonText.toLowerCase().includes(keyword))) {
      return 10;
    }
    
    return 0;
  }

  // Determine risk level based on credibility score
  determineRiskLevel(score) {
    if (score >= 70) return 'low';
    if (score >= 40) return 'medium';
    return 'high';
  }

  // Detect suspicious patterns
  detectPatterns(request, history) {
    const patterns = [];
    
    // Weekend pattern detection
    if (this.isWeekendPattern(request.leaveDate, history)) {
      patterns.push({
        type: 'weekend_pattern',
        description: 'Frequent requests on Fridays/Mondays',
        severity: 'medium'
      });
    }
    
    // Frequency pattern
    const recentRequests = this.getRecentRequests(history, 30);
    if (recentRequests.length > 3) {
      patterns.push({
        type: 'high_frequency',
        description: `${recentRequests.length} requests in last 30 days`,
        severity: 'high'
      });
    }
    
    // Short notice pattern
    if (this.getDaysInAdvance(request.leaveDate) <= 1) {
      patterns.push({
        type: 'short_notice',
        description: 'Request made with very short notice',
        severity: 'medium'
      });
    }
    
    // Duplicate reason pattern
    if (this.hasDuplicateReasons(request.reasonText, history)) {
      patterns.push({
        type: 'duplicate_reason',
        description: 'Similar reason used in previous requests',
        severity: 'high'
      });
    }
    
    return patterns;
  }

  // Generate AI recommendations
  generateRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.credibilityScore >= 70) {
      recommendations.push({
        action: 'approve',
        confidence: 'high',
        reason: 'High credibility score and no suspicious patterns detected'
      });
    } else if (analysis.credibilityScore >= 40) {
      recommendations.push({
        action: 'review',
        confidence: 'medium',
        reason: 'Moderate credibility score - manual review recommended'
      });
    } else {
      recommendations.push({
        action: 'reject',
        confidence: 'high',
        reason: 'Low credibility score and suspicious patterns detected'
      });
    }
    
    // Additional specific recommendations
    if (analysis.patterns.some(p => p.type === 'high_frequency')) {
      recommendations.push({
        action: 'investigate',
        confidence: 'medium',
        reason: 'Student has high frequency of leave requests - consider counseling'
      });
    }
    
    if (analysis.patterns.some(p => p.type === 'weekend_pattern')) {
      recommendations.push({
        action: 'monitor',
        confidence: 'medium',
        reason: 'Monitor for weekend leave patterns - possible attendance avoidance'
      });
    }
    
    return recommendations;
  }

  // Generate warning flags
  generateFlags(request, history) {
    const flags = [];
    
    // Critical flags
    if (this.getDaysInAdvance(request.leaveDate) === 0) {
      flags.push({
        type: 'critical',
        message: 'Same-day leave request',
        icon: '🚨'
      });
    }
    
    if (this.getRecentRequests(history, 7).length > 1) {
      flags.push({
        type: 'critical',
        message: 'Multiple requests in past week',
        icon: '⚠️'
      });
    }
    
    // Warning flags
    if (this.isExamPeriod(request.leaveDate)) {
      flags.push({
        type: 'warning',
        message: 'Request during exam period',
        icon: '📚'
      });
    }
    
    if (request.reasonText && request.reasonText.length < 20) {
      flags.push({
        type: 'warning',
        message: 'Very brief reason provided',
        icon: '📝'
      });
    }
    
    // Info flags
    if (this.getDaysInAdvance(request.leaveDate) >= 7) {
      flags.push({
        type: 'info',
        message: 'Good advance notice provided',
        icon: '✅'
      });
    }
    
    return flags;
  }

  // Helper functions
  getRecentRequests(history, days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return history.filter(request => 
      new Date(request.created_at) >= cutoffDate
    );
  }

  getDaysInAdvance(leaveDate) {
    const today = new Date();
    const leave = new Date(leaveDate);
    const diffTime = leave - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  isWeekendPattern(leaveDate, history) {
    const date = new Date(leaveDate);
    const dayOfWeek = date.getDay();
    
    // Check if current request is Friday (5) or Monday (1)
    if (dayOfWeek !== 1 && dayOfWeek !== 5) return false;
    
    // Check if student has pattern of Friday/Monday requests
    const weekendRequests = history.filter(request => {
      const reqDate = new Date(request.leave_date);
      const reqDay = reqDate.getDay();
      return reqDay === 1 || reqDay === 5;
    });
    
    return weekendRequests.length >= 2 && weekendRequests.length / history.length > 0.4;
  }

  isExamPeriod(leaveDate) {
    // Simple exam period detection (can be enhanced with actual academic calendar)
    const date = new Date(leaveDate);
    const month = date.getMonth();
    
    // Assume exam periods: April (3), October (9), December (11)
    return month === 3 || month === 9 || month === 11;
  }

  hasDuplicateReasons(reasonText, history) {
    if (!reasonText || history.length === 0) return false;
    
    const currentReason = reasonText.toLowerCase().trim();
    
    return history.some(request => {
      if (!request.reason_text) return false;
      const pastReason = request.reason_text.toLowerCase().trim();
      
      // Check for exact match or high similarity
      return pastReason === currentReason || 
             this.calculateSimilarity(currentReason, pastReason) > 0.8;
    });
  }

  calculateSimilarity(str1, str2) {
    // Simple similarity calculation using Levenshtein distance
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  // Generate summary report for faculty
  generateSummaryReport(analysis, studentInfo) {
    return {
      studentName: studentInfo.name,
      studentId: studentInfo.studentId,
      credibilityScore: analysis.credibilityScore,
      riskLevel: analysis.riskLevel,
      recommendation: analysis.recommendations[0],
      keyFlags: analysis.flags.filter(f => f.type === 'critical' || f.type === 'warning'),
      patternSummary: analysis.patterns.length > 0 ? 
        `${analysis.patterns.length} suspicious pattern(s) detected` : 
        'No suspicious patterns detected',
      aiConfidence: this.calculateAIConfidence(analysis)
    };
  }

  calculateAIConfidence(analysis) {
    let confidence = 70; // Base confidence
    
    // Increase confidence based on clear patterns
    if (analysis.patterns.length > 2) confidence += 15;
    if (analysis.credibilityScore > 80 || analysis.credibilityScore < 20) confidence += 10;
    
    return Math.min(95, confidence);
  }
}

module.exports = AILeaveAnalyzer;